// Local-only static preview. No Athena runtime, configuration or network APIs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8', '.json': 'application/json' };
const port = Number(process.env.ATHENA_PREVIEW_PORT || 4174);
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  let file;
  try { const url = new URL(req.url, 'http://127.0.0.1'); file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if (!file.startsWith(root + path.sep) || !mime[path.extname(file)]) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
});
server.listen(port, '127.0.0.1', () => console.log(`Athena companion prototype: http://127.0.0.1:${port}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
