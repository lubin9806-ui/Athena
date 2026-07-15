/**
 * Athena 桌面助手 — 所有功能操作
 * 打开软件、搜索、天气、新闻、打开文件
 */

const http = require('http');
const https = require('https');
const { execSync, exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// ========== 已知软件路径 ==========
const KNOWN_APPS = {
  'vscode': { path: 'code', type: 'cmd' },
  'vs code': { path: 'code', type: 'cmd' },
  'visual studio code': { path: 'code', type: 'cmd' },
  'comfyui': { path: 'start "" "http://127.0.0.1:8188"', type: 'cmd' },
  'edge': { path: 'start msedge', type: 'cmd' },
  'chrome': { path: 'start chrome', type: 'cmd' },
  'b站': { path: 'start https://www.bilibili.com', type: 'cmd' },
  'bilibili': { path: 'start https://www.bilibili.com', type: 'cmd' },
  'github': { path: 'start https://github.com', type: 'cmd' },
  'youtube': { path: 'start https://youtube.com', type: 'cmd' },
  '计算器': { path: 'calc', type: 'exe' },
  '记事本': { path: 'notepad', type: 'exe' },
  '画图': { path: 'mspaint', type: 'exe' },
  'cmd': { path: 'cmd', type: 'exe' },
  '命令提示符': { path: 'cmd', type: 'exe' },
};

const KNOWN_FOLDERS = {
  '作品': 'G:\\generated',
  '项目': 'G:\\Athena',
  'vs项目': 'd:\\vs\\vs.6',
  '下载': process.env.USERPROFILE + '\\Downloads',
  '桌面': process.env.USERPROFILE + '\\Desktop',
  '文档': process.env.USERPROFILE + '\\Documents',
  '图片': process.env.USERPROFILE + '\\Pictures',
};

// ========== 辅助函数 ==========
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/[\s\r\n]+/g, ' ').trim();
}

/** 使用 curl 获取网页文本 */
function curl(url) {
  return new Promise((resolve, reject) => {
    exec(
      `curl -s -L --max-time 6 -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" -H "Accept-Language: zh-CN,zh;q=0.9" "${url}"`,
      { encoding: 'utf8', timeout: 8000, windowsHide: true, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout) => {
        if (err) { reject(err.message || 'curl failed'); return; }
        if (stdout && stdout.length > 100) resolve(stdout);
        else reject('empty response');
      }
    );
  });
}

let browserInstance = null;
async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  }
  return browserInstance;
}

async function searchBingRendered(query) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const results = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.b_algo'));
      return items.slice(0, 5).map(el => {
        const title = el.querySelector('h2 a')?.innerText?.trim() || '';
        const snippet = el.querySelector('.b_caption p')?.innerText?.trim() || '';
        return snippet ? `${title}：${snippet}` : title;
      }).filter(t => t.length > 2 && !t.includes('sourceMapping') && !t.includes('sourceURL'));
    });
    await page.close();
    if (results.length > 0) return results.join('\n');
    throw new Error('no results');
  } catch (e) {
    await page.close();
    throw e;
  }
}

/** Bing 搜索（curl 实现——更稳定） */
function searchBing(query) {
  return new Promise((resolve, reject) => {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=5`;
    curl(url).then(html => {
      try {
        const results = [];
        console.log('[Bing调试] 页面长度:', html.length);
        const debugMatches = html.match(/<li[^>]*class="b_algo"[^>]*>/gi) || [];
        console.log('[Bing调试] b_algo区块数量:', debugMatches.length);
        // Bing 结果条目：<li class="b_algo">
        const itemRegex = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
        let match;
        while ((match = itemRegex.exec(html)) !== null && results.length < 5) {
          const block = match[1];
          const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/i);
          const title = titleMatch ? stripHtml(titleMatch[1]) : '';
          console.log('[Bing调试] 第', results.length + 1, '条候选标题:', title);
          if (!title || title.length < 2) continue;
          const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
          const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';
          if (!title.includes('sourceMapping') && !title.includes('sourceURL')) {
            results.push(snippet ? `${title}：${snippet}` : title);
          }
        }
        if (results.length > 0) resolve(results.join('\n'));
        else reject('no bing results');
      } catch { reject('bing parse error'); }
    }).catch(reject);
  });
}

/** 百度搜索（curl 实现） */
function searchBaidu(query) {
  return new Promise((resolve, reject) => {
    const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=5`;
    curl(url).then(html => {
      try {
        const results = [];
        // 百度新版：class="c-container" 或 class="result"
        const cardRegex = /<div[^>]*class="[^"]*(?:c-container|result)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
        let match;
        while ((match = cardRegex.exec(html)) !== null && results.length < 5) {
          const block = match[1];
          const titleMatch = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h3>/i);
          const title = titleMatch ? stripHtml(titleMatch[1]) : '';
          if (!title || title.length < 2) continue;
          let snippet = '';
          const absMatch = block.match(/<span[^>]*class="[^"]*content-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
          if (absMatch) snippet = stripHtml(absMatch[1]);
          if (!snippet) {
            const absMatch2 = block.match(/class="c-abstract"[^>]*>([\s\S]*?)<\/span>/i);
            if (absMatch2) snippet = stripHtml(absMatch2[1]);
          }
          if (!snippet) {
            const textBlock = block.replace(/<h3[\s\S]*?<\/h3>/i, '');
            const textMatch = textBlock.match(/([\u4e00-\u9fa5\w][\u4e00-\u9fa5\w\s,，。.．!！?？、；：;:）\)\d%\-+·]{10,})/);
            if (textMatch) snippet = textMatch[1].trim().substring(0, 120);
          }
          results.push(snippet ? `${title}：${snippet}` : title);
        }
        if (results.length > 0) return resolve(results.join('\n'));

        // 备用：h3 > a
        const results2 = [];
        const h3Regex = /<h3[^>]*>[\s\S]*?<a[^>]*href="https?:\/\/[^"]*"[^>]*>(.*?)<\/a>[\s\S]*?<\/h3>/gi;
        while ((match = h3Regex.exec(html)) !== null && results2.length < 5) {
          const t = stripHtml(match[1]);
          if (t && t.length > 2 && !results2.includes(t)) results2.push(t);
        }
        if (results2.length > 0) return resolve(results2.join('\n'));
        reject('no baidu results');
      } catch { reject('baidu parse error'); }
    }).catch(reject);
  });
}

function searchDuckDuckGo(query) {
  return new Promise((resolve, reject) => {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const items = [];
          const answer = json.AbstractText || json.Answer || '';
          if (answer && answer.length > 3) items.push(answer);
          const related = (json.RelatedTopics || []).slice(0, 5);
          related.forEach(t => {
            const txt = t.Text || t.Result || '';
            if (txt && txt.length > 3) items.push(txt);
          });
          if (items.length > 0) resolve(items.join('\n'));
          else reject('ddg empty');
        } catch { reject('ddg parse error'); }
      });
    });
    req.on('error', () => reject('ddg network error'));
    req.setTimeout(8000, () => { req.destroy(); reject('ddg timeout'); });
    req.end();
  });
}

/** 统一搜索入口：Puppeteer 渲染 Bing → curl Bing → 百度 → DuckDuckGo 逐级 fallback */
function searchWeb(query) {
  console.log('[搜索请求]', query);
  return new Promise((resolve) => {
    searchBingRendered(query)
      .then(r => { console.log('[Puppeteer渲染成功]', r.slice(0,100)); resolve(r); })
      .catch(() => {
        console.log('[Puppeteer失败，尝试Bing curl]');
        searchBing(query)
          .then(r => { console.log('[Bing curl成功]', r.slice(0,100)); resolve(r); })
          .catch(() => {
            console.log('[Bing curl失败，尝试百度]');
            searchBaidu(query)
              .then(r => { console.log('[百度成功]', r.slice(0,100)); resolve(r); })
              .catch(() => {
                console.log('[百度失败，尝试DDG]');
                searchDuckDuckGo(query)
                  .then(r => { console.log('[DDG成功]', r.slice(0,100)); resolve(r); })
                  .catch(() => {
                    console.log('[全部搜索源均失败]');
                    resolve(`搜索"${query}"没有找到有效结果`);
                  });
              });
          });
      });
  });
}

// ========== 2-6. 打开软件、文件夹、天气、新闻、动作分发 ==========
function openApp(name) {
  const lower = name.toLowerCase().trim();
  for (const [key, val] of Object.entries(KNOWN_APPS)) {
    if (lower.includes(key)) {
      try { exec(val.path); return `好的，帮你打开${name}了~`; }
      catch(e) { return `打开${name}失败了：${e.message}`; }
    }
  }
  if (name.includes('.') || name.includes('com') || name.includes('cn')) {
    try { const url = name.startsWith('http') ? name : 'https://' + name; exec(`start "" "${url}"`); return `打开了${name}~`; }
    catch {}
  }
  exec(`start "" "https://www.baidu.com/s?wd=${encodeURIComponent(name)}"`);
  return `没找到"${name}"，帮你搜了一下`;
}

function openFolder(name) {
  const lower = name.toLowerCase();
  for (const [key, dir] of Object.entries(KNOWN_FOLDERS)) {
    if (lower.includes(key)) {
      if (fs.existsSync(dir)) { openExplorer(dir); return `打开了${name}文件夹~`; }
      return `${name}文件夹不存在呢`;
    }
  }
  if (fs.existsSync(name)) {
    openExplorer(name);
    return `打开了~`;
  }
  return `找不到${name}文件夹`;
}

function openExplorer(target) {
  const child = spawn('explorer.exe', [target], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

const QWEATHER_HOST = 'nc6pg9rj8w.re.qweatherapi.com';
const QWEATHER_KEY = 'b314eb0bc5474f0bb96905c36bfc6c1e';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    exec(
      `curl -s --compressed --max-time 8 "${url}"`,
      { encoding: 'utf8', timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) { reject(err.message); return; }
        try { resolve(JSON.parse(stdout)); }
        catch { reject('parse error'); }
      }
    );
  });
}

function getWeather(city) {
  return new Promise((resolve) => {
    const cityName = city || '西安';
    const lookupUrl = `https://${QWEATHER_HOST}/geo/v2/city/lookup?location=${encodeURIComponent(cityName)}&key=${QWEATHER_KEY}`;
    
    fetchJson(lookupUrl).then(geo => {
      if (!geo.location || geo.location.length === 0) {
        resolve(`没查到"${cityName}"这个城市~`);
        return;
      }
      const locationId = geo.location[0].id;
      const weatherUrl = `https://${QWEATHER_HOST}/v7/weather/now?location=${locationId}&key=${QWEATHER_KEY}`;
      return fetchJson(weatherUrl);
    }).then(w => {
      if (w && w.code === '200') {
        const n = w.now;
        resolve(`${cityName}天气：${n.text}，气温${n.temp}℃，体感${n.feelsLike}℃，湿度${n.humidity}%，风速${n.windSpeed}km/h`);
      } else {
        resolve('查天气失败，接口返回异常~');
      }
    }).catch(() => {
      resolve('查天气失败，可能网络不通~');
    });
  });
}

function getNews() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'weibo.com',
      path: '/ajax/side/hotSearch',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://weibo.com/',
      }
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const reals = json.data?.realtime || [];
          const top10 = reals.slice(0, 10).map((item, i) => `${i+1}. ${item.word}`).join('\n');
          if (top10) resolve(`微博热搜榜 TOP10：\n${top10}`);
          else resolve('今天没什么特别的热搜~');
        } catch (e) { console.log('[新闻解析失败]', e.message, data.slice(0,200)); resolve('获取热搜失败了~'); }
      });
    });
    req.on('error', () => resolve('获取热搜失败了~'));
    req.setTimeout(8000, () => { req.destroy(); resolve('获取热搜超时了~'); });
    req.end();
  });
}

async function executeAction(type, param) {
  switch (type) {
    case 'search': return await searchWeb(param);
    case 'open': return openApp(param);
    case 'openfile': case 'folder': return openFolder(param);
    case 'weather': return await getWeather(param);
    case 'news': return await getNews();
    default: return `不知道怎么做"${type}"呢~`;
  }
}

function detectAction(text) {
  const t = text.toLowerCase().trim();
  
  // ===== 高优先级：天气/新闻（放在搜索前面，避免"天气"关键词被搜索规则截胡） =====
  const weatherMatch = t.match(/(?:查|看|问|今天|现在|帮我)?\s*([^，。！？\s]{2,20})?(?:天气|下雨|温度|几度)/);
  if (weatherMatch || t.includes('天气') || t.includes('下雨') || t.includes('温度') || t.includes('几度')) {
    return { type: 'weather', param: weatherMatch?.[1] || '' };
  }
  if (t.includes('新闻') || t.includes('热搜') || t.includes('热点') || t.includes('有什么大事')) return { type: 'news', param: '' };
  
  // ===== 搜索 =====
  // "搜XXX" → 跳过"搜索"、"搜一下"、"搜索一下"
  const searchMatch = t.match(/搜(?:索)?\s*(?:一下)?\s*(.+)/);
  if (searchMatch && searchMatch[1].length > 1) return { type: 'search', param: searchMatch[1] };
  const searchMatch2 = t.match(/(?:帮我|给我)?查(?:一下)?\s*(.+)/);
  if (searchMatch2 && searchMatch2[1].length > 1) return { type: 'search', param: searchMatch2[1] };
  
  const excludeWords = ['你', '我', '他', '我们', '你们', '今天', '现在', '最近', '刚才'];
  function isQueryWord(w) { return w && w.length >= 2 && !excludeWords.includes(w); }
  
  const newMatch = t.match(/(.+?)(?:最新款|新款|新一代|新发布|报价|价格|多少钱)/);
  if (newMatch) { const p = newMatch[1].trim(); if (isQueryWord(p)) return { type: 'search', param: newMatch[0] }; }
  
  const whatMatch = t.match(/(.+?)(是什么|是啥|是什么意思)/);
  if (whatMatch) { const p = whatMatch[1].trim(); if (isQueryWord(p)) return { type: 'search', param: p + whatMatch[2] }; }
  
  const hasMatch = t.match(/(?:有什么|有没有)\s*(.+?)(?:吗|么|的|可以|推荐)/);
  if (hasMatch) { const p = hasMatch[1].trim(); if (isQueryWord(p) && p.length > 1) return { type: 'search', param: '有什么' + p }; }
  
  const knowMatch = t.match(/知道\s*(.+?)(?:吗|么|嘛|不)\s*$/);
  if (knowMatch) { const p = knowMatch[1].trim(); if (isQueryWord(p) && p.length > 1 && !p.startsWith('我') && !p.startsWith('你')) return { type: 'search', param: p }; }
  
  const recMatch = t.match(/推荐\s*(.+)/);
  if (recMatch) { const p = recMatch[1].trim(); if (isQueryWord(p)) return { type: 'search', param: p + '推荐' }; }
  
  const openMatch = t.match(/(?:打开|启动|开启)\s*(.+)/);
  if (openMatch) {
    const what = openMatch[1];
    if (what.includes('文件夹') || what.includes('目录') || what.includes('盘') || what.includes(':\\')) return { type: 'folder', param: what };
    return { type: 'open', param: what };
  }
  
  return null;
}

module.exports = { executeAction, detectAction, openApp, searchWeb, getWeather, getNews, openFolder };
