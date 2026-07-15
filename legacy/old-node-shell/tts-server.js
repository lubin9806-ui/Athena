/**
 * TTS 独立语音服务
 * 调用方式: GET http://localhost:3001/tts?text=你好
 * 返回: audio/mpeg 音频流
 */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = 3001;
const PY = 'C:\\Users\\lubin\\AppData\\Local\\Programs\\Python\\Python311\\python.exe';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (path === '/tts') {
    const text = url.searchParams.get('text') || '';
    if (!text) {
      res.writeHead(400);
      res.end('no text');
      return;
    }

    // 把文本写入临时文件，避免中文参数传递问题
    const textFile = `G:\\Athena\\tts_text_${Date.now()}.txt`;
    const outFile = `G:\\Athena\\tts_${Date.now()}.mp3`;
    fs.writeFileSync(textFile, text, 'utf8');
    
    // 用批处理方式调用 Python（避免 cmd 编码问题）
    const useTextFile = true;
    const proc = spawn(PY, ['G:\\Athena\\tts.py', '@' + textFile, 'zh-CN-XiaoxiaoNeural', outFile]);

    let done = false;
    proc.on('close', (code) => {
      if (done) return;
      done = true;
      if (code === 0 && fs.existsSync(outFile)) {
        const data = fs.readFileSync(outFile);
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': data.length });
        res.end(data);
        fs.unlink(outFile, () => {});
      } else {
        res.writeHead(500);
        res.end('tts failed');
      }
    });
    
    proc.on('error', () => {
      if (!done) { done = true; res.writeHead(500); res.end('error'); }
    });

    setTimeout(() => {
      if (!done) { done = true; res.writeHead(504); res.end('timeout'); }
    }, 30000);

    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});

server.listen(PORT, () => {
  console.log(`  🔊 TTS 服务运行: http://localhost:${PORT}`);
});