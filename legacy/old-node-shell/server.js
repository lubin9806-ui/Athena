/**
 * Athena 本地后端服务器
 * 替代 Electron，通过浏览器访问
 * 
 * 启动方法：node server.js
 * 访问地址：http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript',
  '.ts': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let url = req.url;
  if (url === '/') url = '/index.html';
  if (url === '/chat') url = '/index.html';

  // API 代理到 Ollama
  if (url.startsWith('/api/')) {
    const options = {
      hostname: '127.0.0.1',
      port: 11434,
      path: url,
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
    };
    const proxy = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    req.pipe(proxy);
    return;
  }

  const filePath = path.join(__dirname, 'src', 'renderer', url);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    res.end(data);
  });
});

// 检查 Ollama 是否运行
function checkOllama() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:11434/api/tags', (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

server.listen(PORT, async () => {
  console.log('');
  console.log('  ╔══════════════════════════════╗');
  console.log('  ║      Athena 已启动           ║');
  console.log('  ╚══════════════════════════════╝');
  console.log('');
  console.log(`  🌐 打开浏览器访问:`);
  console.log(`  http://localhost:${PORT}`);
  console.log('');

  const ollamaOk = await checkOllama();
  if (ollamaOk) {
    console.log('  ✅ Ollama 服务已就绪');
  } else {
    console.log('  ⚠️  Ollama 未运行，请先启动 ollama serve');
  }
  console.log('');

  // 自动打开浏览器
  const { exec } = require('child_process');
  exec(`start http://localhost:${PORT}`);
});