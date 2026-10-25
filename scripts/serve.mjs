// Tiny static server for local previews: node scripts/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 4173;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

http
  .createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.join(root, rel);
      const inside = path.relative(root, file);
      if (inside.startsWith('..') || path.isAbsolute(inside)) throw Object.assign(new Error('forbidden'), { code: 'EACCES' });
      let st = await fs.stat(file).catch(() => null);
      if (st?.isDirectory()) {
        file = path.join(file, 'index.html');
        st = await fs.stat(file).catch(() => null);
      }
      if (!st) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(await fs.readFile(file));
    } catch (e) {
      res.writeHead(e.code === 'EACCES' ? 403 : 404, { 'content-type': 'text/plain' });
      res.end(String(e.message));
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
