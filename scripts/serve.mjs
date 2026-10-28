import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
export function createStaticServer(root = path.resolve('dist')) {
    return http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://localhost');
            const file = path.resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
            if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
            const info = await stat(file);
            if (!info.isFile()) throw new Error('not a file');
            res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            res.end(await readFile(file));
        } catch { res.writeHead(404); res.end('Not found'); }
    });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const server = createStaticServer();
    const port = Number(process.env.PORT || 4173);
    server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${server.address().port}`));
}
