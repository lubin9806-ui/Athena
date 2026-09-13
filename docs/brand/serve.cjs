// Side-by-side brand prototypes only. This does not launch the Athena runtime.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8', '.json': 'application/json'};
http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  let file;
  try {
    let name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (name === '/' || ['/companion-prototype', '/atelier-prototype'].includes(name)) {
      res.writeHead(302, {Location: name === '/' ? '/companion-prototype/' : `${name}/`, 'Cache-Control': 'no-store'}); res.end(); return;
    }
    if (name.endsWith('/')) name += 'index.html'; file = path.resolve(root, '.' + name);
  }
  catch { res.writeHead(400); res.end(); return; }
  if (!file.startsWith(root + path.sep) || !mime[path.extname(file)]) { res.writeHead(404); res.end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); res.end(req.method === 'HEAD' ? undefined : bytes);
  });
}).listen(4175, '127.0.0.1', () => console.log('Athena theme prototypes: http://127.0.0.1:4175/theme-presets.html'));
