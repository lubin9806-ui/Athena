/**
 * Athena — 苏时夏 人格版
 * 浏览器聊天 + 记忆系统 + 角色扮演
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { executeAction } = require('./skills/actions');

const PORT = 3000;
const OLLAMA_URL = 'http://127.0.0.1:11434';
const { personality } = require('./personality/sushixia');

// Python 路径：优先环境变量，其次硬编码
const PYTHON = process.env.PYTHON_PATH || 'C:\\Users\\lubin\\AppData\\Local\\Programs\\Python\\Python311\\python.exe';

// ========== 记忆系统（文件存储版） ==========
const MEMORY_DIR = path.join(__dirname, 'memory');
const USER_DATA_FILE = path.join(MEMORY_DIR, 'user_data.json');
const EVENTS_FILE = path.join(MEMORY_DIR, 'events.json');
const CHAT_LOG_FILE = path.join(MEMORY_DIR, 'chat_log.json');

if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// 用户画像
function getUserProfile() {
  const data = readJson(USER_DATA_FILE);
  if (data) return data;
  const init = {
    identity: ['用户是哥哥'],
    preferences: [],
    habits: [],
    projects: [],
    health: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  writeJson(USER_DATA_FILE, init);
  return init;
}

function updateUserProfile(fact, category = 'preferences') {
  const profile = getUserProfile();
  if (!profile[category].includes(fact)) {
    profile[category].push(fact);
    // 最多保留最近15条，防止System Prompt被撑爆
    if (profile[category].length > 15) {
      profile[category] = profile[category].slice(-15);
    }
    profile.updated_at = new Date().toISOString();
    writeJson(USER_DATA_FILE, profile);
  }
}

// 事件记录
function getEvents() {
  return readJson(EVENTS_FILE) || [];
}

function addEvent(summary, importance = 5) {
  const events = getEvents();
  events.unshift({
    id: Date.now(),
    date: new Date().toISOString().split('T')[0],
    summary,
    importance,
    recalled: false,
  });
  if (events.length > 200) events.length = 200;
  writeJson(EVENTS_FILE, events);
}

// 对话日志
function getChatLog() {
  return readJson(CHAT_LOG_FILE) || [];
}

function addChatLog(role, content) {
  const log = getChatLog();
  log.push({ role, content, time: new Date().toISOString() });
  if (log.length > 100) log.splice(0, log.length - 100);
  writeJson(CHAT_LOG_FILE, log);
}

// 从消息中提取记忆
function extractMemory(text) {
  const facts = [];
  const trimmed = text.trim();
  // 疑问句、过短的话不提取（不是陈述性事实）
  if (/[？?]$/.test(trimmed) || trimmed.length < 4) return facts;

  const patterns = [
    /我(?:喜欢|爱好是|讨厌|不喜欢|最近在)([^，。！？\n~]{2,20})/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const fact = match[0].trim();
      if (fact.length > 3 && fact.length < 25 && !facts.includes(fact)) {
        facts.push(fact);
      }
    }
  }
  return facts;
}

// ========== web_search 工具定义 ==========
const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '搜索最新信息。当用户询问任何产品最新款、新闻、天气、股价等有时效性的问题时，必须调用此函数。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词',
        },
      },
      required: ['query'],
    },
  },
};

// 调用 Ollama /api/chat
function callOllama(messages, tools) {
  return new Promise((resolve, reject) => {
    const body = { model: 'athena-model', messages, stream: false };
    if (tools) body.tools = tools;
    const options = {
      hostname: '127.0.0.1', port: 11434, path: '/api/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    let done = false;
    const timer = setTimeout(() => {
      if (done) return; done = true;
      req.destroy(); reject('timeout');
    }, 60000);
    const req = http.request(options, (proxyRes) => {
      let data = '';
      proxyRes.on('data', c => data += c);
      proxyRes.on('end', () => {
        if (done) return; done = true; clearTimeout(timer);
        try { resolve(JSON.parse(data)); }
        catch { reject('parse error'); }
      });
    });
    req.on('error', () => { if (done) return; done = true; clearTimeout(timer); reject('network error'); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

// 从消息中提取搜索关键词（模型没触发 tool_calls 时的关键词兜底）
function extractSearchQuery(text) {
  const lower = text.toLowerCase();
  const searchPatterns = [
    /(?:搜|查|找|帮我搜|帮我查|帮我找)\s*(?:一下)?\s*(.{2,40})/,
    /(.{2,20})(?:最新款|新款|最新|报价|价格|多少钱|是什么|是啥)/,
    /(?:最新|今天|现在)\s*(.{2,30})/,
  ];
  for (const p of searchPatterns) {
    const m = lower.match(p);
    if (m && m[1] && m[1].length > 1) return m[1].trim();
  }
  return null;
}

// 清理回复中残留的工具调用 JSON
function cleanReply(text) {
  return text
    .replace(/\{"name":\s*"[^"]+",\s*"arguments":\s*\{[^}]*\}\}\s*\]?=\]?/g, '')
    .replace(/forCell\s*\{"name":\s*"[^"]+",\s*"arguments":\s*\{[^}]*\}\}\s*\]?=\]?/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/{"name":\s*"[^"]+",\s*"arguments":\s*\{[^}]*\}\}/g, '')
    .trim();
}

// ========== 构建 System Prompt ==========
function buildSystemPrompt() {
  const now = new Date();
  const hour = now.getHours();
  const profile = getUserProfile();
  const events = getEvents().slice(0, 3);
  let timeGreeting = '';
  if (hour >= 5 && hour < 8) timeGreeting = '早上好~';
  else if (hour >= 8 && hour < 12) timeGreeting = '上午好~';
  else if (hour >= 12 && hour < 14) timeGreeting = '中午好~';
  else if (hour >= 14 && hour < 18) timeGreeting = '下午好~';
  else if (hour >= 18 && hour < 22) timeGreeting = '晚上好~';
  else timeGreeting = '这么晚还没睡呀~';

  return `你是 ${personality.name}，${personality.age} 岁的妹妹。
${timeGreeting} 现在是${hour}点。
${personality.chatStyle.slice(0, 3).join('\n')}
关于哥哥：${profile.identity.join('，')}${profile.preferences.length > 0 ? '，' + profile.preferences.join('，') : ''}
${events.length > 0 ? '最近：' + events.slice(0, 2).map(e => e.summary).join('；') : ''}
请用中文回复。
回复要简短自然，像日常聊天不要超过两行。
涉及产品最新款、新闻、天气等时效性问题，请使用 web_search 工具搜索最新信息。日常聊天不需要搜索。`;
}

// ========== 1. 确保 Ollama 运行 ==========
console.log('[Athena] 检查 Ollama...');
const ollamaReq = http.get(`${OLLAMA_URL}/api/tags`, (res) => {
  if (res.statusCode !== 200) startOllama();
  else startServer();
});
ollamaReq.on('error', () => startOllama());
ollamaReq.end();

function startOllama() {
  console.log('[Athena] 启动 Ollama...');
  const ollama = spawn('ollama', ['serve'], {
    detached: true, stdio: 'ignore',
    env: { ...process.env, PATH: process.env.PATH + ';C:\\Users\\lubin\\AppData\\Local\\Programs\\Ollama' }
  });
  ollama.unref();
  waitForOllama();
}

function waitForOllama(n = 0) {
  if (n > 30) { startServer(); return; }
  const req = http.get(`${OLLAMA_URL}/api/tags`, (res) => {
    if (res.statusCode === 200) startServer();
    else setTimeout(() => waitForOllama(n + 1), 2000);
  });
  req.on('error', () => setTimeout(() => waitForOllama(n + 1), 2000));
  req.end();
}

// ========== 2. HTTP 服务器 ==========
function startServer() {
  console.log('[Athena] 启动服务器...');

  const server = http.createServer((req, res) => {
    const url = req.url;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // TTS API
    if (url.startsWith('/api/tts') && req.method === 'GET') {
      const params = new URL(url, `http://${req.headers.host}`).searchParams;
      const text = params.get('text') || '';
      if (!text) { res.writeHead(400); res.end('no text'); return; }
      const textFile = `G:\\Athena\\tts_txt_${Date.now()}.txt`;
      const outFile = `G:\\Athena\\tts_${Date.now()}.mp3`;
      fs.writeFileSync(textFile, text, 'utf8');
      const proc = spawn(PYTHON, ['G:\\Athena\\tts.py', '@' + textFile, 'zh-CN-XiaoxiaoNeural', outFile]);
      let done = false;
      const timeout = setTimeout(() => { if (!done) { done = true; res.writeHead(504); res.end('timeout'); } }, 20000);
      proc.on('close', (code) => {
        if (done) return; done = true; clearTimeout(timeout);
        if (code === 0 && fs.existsSync(outFile)) {
          const audio = fs.readFileSync(outFile);
          res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
          res.end(audio);
          try { fs.unlinkSync(outFile); } catch {} try { fs.unlinkSync(textFile); } catch {}
        } else {
          res.writeHead(500); res.end(JSON.stringify({ error: 'tts failed' }));
          try { fs.unlinkSync(textFile); } catch {}
        }
      });
      proc.on('error', () => { if (!done) { done = true; clearTimeout(timeout); res.writeHead(500); res.end('error'); } });
      return;
    }

    // STT API
    if (url === '/api/stt' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { audio } = JSON.parse(body);
          if (!audio) { res.writeHead(400); res.end(JSON.stringify({ error: 'no audio' })); return; }
          const audioPath = `G:\\Athena\\stt_${Date.now()}.wav`;
          fs.writeFileSync(audioPath, Buffer.from(audio, 'base64'));
          const proc = spawn(PYTHON, ['G:\\Athena\\stt.py', audioPath]);
          let out = '';
          let errOut = '';
          proc.stdout.on('data', d => out += d);
          proc.stderr.on('data', d => errOut += d);
          let done = false;
          const timer = setTimeout(() => {
            if (done) return; done = true;
            try { proc.kill(); } catch {}
            res.writeHead(504); res.end(JSON.stringify({ text: '', error: 'timeout' }));
          }, 30000);
          proc.on('close', (code) => {
            if (done) return; done = true; clearTimeout(timer);
            const text = out.trim();
            const fileSize = fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 0;
            console.log('[Athena] STT result:', text || '(empty)', 'code:', code, 'size:', fileSize, 'stderr:', errOut.trim().slice(0,500));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ text }));
            try { fs.unlinkSync(audioPath); } catch {}
          });
          proc.on('error', (e) => {
            if (done) return; done = true; clearTimeout(timer);
            console.error('[Athena] STT spawn error:', e.message);
            res.writeHead(500); res.end(JSON.stringify({ error: 'stt failed: ' + e.message }));
          });
        } catch(e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // ========== 聊天 API ==========
    if (url === '/api/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        const userMsg = JSON.parse(body).messages?.slice(-1)[0]?.content || '';
        
        addChatLog('user', userMsg);
        const facts = extractMemory(userMsg);
        facts.forEach(f => updateUserProfile(f));

        if (userMsg.includes('今天') || userMsg.includes('昨天') || userMsg.includes('周末')) {
          const importantFacts = facts.filter(f => f.length > 5);
          if (importantFacts.length > 0) addEvent(importantFacts[0], 6);
        }

        const systemPrompt = buildSystemPrompt();
        const chatLog = getChatLog().slice(-6);
        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();
        const timeStr = `${h}:${m.toString().padStart(2, '0')}`;
        let timeDesc = '';
        if (h >= 5 && h < 8) timeDesc = '早上（刚醒）';
        else if (h >= 8 && h < 12) timeDesc = '上午';
        else if (h >= 12 && h < 14) timeDesc = '中午';
        else if (h >= 14 && h < 18) timeDesc = '下午';
        else if (h >= 18 && h < 22) timeDesc = '晚上';
        else timeDesc = '凌晨';

        let messages = [
          { role: 'system', content: systemPrompt },
          ...chatLog.map(m => ({ role: m.role, content: m.content })),
          { role: 'system', content: `当前时间：${timeStr}（${timeDesc}）。` },
        ];

        try {
          // 第一轮：带 tools 调用
          let result = await callOllama(messages, [WEB_SEARCH_TOOL]);
          let toolRounds = 0;
          let searched = false;

          // 尝试通过 tool_calls 触发搜索
          while (result.message?.tool_calls && toolRounds < 2) {
            toolRounds++;
            searched = true;
            const tc = result.message.tool_calls[0];
            messages.push({
              role: 'assistant',
              content: result.message?.content || null,
              tool_calls: result.message.tool_calls,
            });

            let query = '';
            try {
              let args = tc.function.arguments;
              if (typeof args === 'string') args = JSON.parse(args);
              if (args && args.query) {
                if (typeof args.query === 'string') query = args.query.trim();
                else if (args.query.string) query = String(args.query.string).trim();
              }
            } catch {}

            if (query) {
              const actionResult = await executeAction('search', query);
              messages.push({ role: 'system', content: `以下是针对"${query}"的联网搜索结果：\n${actionResult}\n请用中文回答用户的问题。` });
              result = await callOllama(messages, null);
            } else {
              break;
            }
          }

          // 兜底：模型没触发 tool_calls，但用户消息需要搜索
          if (!searched) {
            const searchQuery = extractSearchQuery(userMsg);
            if (searchQuery) {
              const actionResult = await executeAction('search', searchQuery);
              if (!actionResult.includes('没有找到有效结果')) {
                messages.push({ role: 'user', content: `${userMsg}\n\n搜索结果是：${actionResult}\n请用中文告诉我。` });
                result = await callOllama(messages, null);
              }
            }
          }

          // 清理回复中残留的 JSON
          const reply = cleanReply(result.message?.content || '这个我不太确定。');
          addChatLog('assistant', reply);
          // 返回干净的回复
          if (result.message?.tool_calls) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ model: result.model, message: { role: 'assistant', content: reply }, done: true }));
          } else {
            result.message.content = reply;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          }

        } catch (e) {
          const errMsg = typeof e === 'string' ? e : (e.message || 'unknown error');
          console.error('[Athena] Chat error:', errMsg);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: { content: `唔…好像出了点问题 (${errMsg})，你等一下噢😅` } }));
        }
      });
      return;
    }

    // 状态 API
    if (url === '/api/status') {
      const check = http.get(`${OLLAMA_URL}/api/tags`, (checkRes) => {
        let data = '';
        checkRes.on('data', d => data += d);
        checkRes.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            ollama: true, 
            models: JSON.parse(data).models || [],
            personality: personality.name,
            memories: getUserProfile(),
            events: getEvents().slice(0, 5),
          }));
        });
      });
      check.on('error', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ollama: false }));
      });
      check.end();
      return;
    }

    // 静态文件
    let filePath = url === '/' || url === '/index.html' 
      ? path.join(__dirname, 'public', 'index.html')
      : path.join(__dirname, 'public', url);
    
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript' };
      res.writeHead(200, { 
        'Content-Type': mime[path.extname(filePath)] || 'text/plain',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(data);
    });
  });

  server.listen(PORT, () => {
    const profile = getUserProfile();
    const events = getEvents();
    console.log('');
    console.log('  ╔══════════════════════════════╗');
    console.log('  ║    苏时夏 · Athena          ║');
    console.log('  ╚══════════════════════════════╝');
    console.log('');
    console.log(`  🌐 http://localhost:${PORT}`);
    console.log(`  👤 人格: ${personality.name}（${personality.identity}）`);
    console.log(`  💾 记忆: ${profile.preferences.length} 条偏好 + ${events.length} 条事件`);
    console.log('');
    // 如果环境变量 ELECTRON_MODE=true，说明是被 Electron spawn 的，不自动打开浏览器
    if (!process.env.ELECTRON_MODE) {
      const { exec } = require('child_process');
      exec(`start http://localhost:${PORT}`);
    }
  });
}