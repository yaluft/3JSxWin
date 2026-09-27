// static-serve.js — dev-only tiny static server for visually checking the web/
// pages (console.html / index.html) outside WebView2. Serves CWD on 8123.
const http = require('http');
const fs = require('fs');
const path = require('path');
const port = 8123;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(process.cwd(), p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log('serving on', port));
