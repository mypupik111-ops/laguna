import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const host = '127.0.0.1';
const port = 4174;
const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${host}`).pathname;
  if (pathname === '/') {
    response.writeHead(302, { Location: '/sea/index.html' }).end();
    return;
  }
  const allowed = /^\/(?:sea\/stillwater\/dist\/(?:[\w-]+\/)*[\w.-]+|sea\/(?:map-tiles\/)?[\w.-]+|dashboard\/[\w.-]+)$/;
  const contentType = types.get(extname(pathname));
  if (!['GET', 'HEAD'].includes(request.method) || !allowed.test(pathname) || !contentType) {
    response.writeHead(404).end();
    return;
  }
  const target = resolve(root, '.' + pathname);
  const file = await stat(target).catch(() => null);
  if (!file?.isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': file.size });
  if (request.method === 'HEAD') response.end();
  else createReadStream(target).pipe(response);
}).listen(port, host, () => console.log(`http://${host}:${port}/sea/stillwater/dist/index.html?map=1`));
