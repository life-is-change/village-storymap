'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const root = fs.realpathSync(path.join(__dirname, '..'));
const upstream = 'https://8.148.248.237';
const port = Number(process.argv[2] || 5502);
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
};

function proxy(request, response, url) {
  const headers = { ...request.headers, host: new URL(upstream).host };
  delete headers.connection;
  const cloud = https.request(upstream + url.pathname + url.search, {
    method: request.method, headers, timeout: 160_000,
  }, result => {
    const headers = { ...result.headers };
    delete headers.connection;
    delete headers['transfer-encoding'];
    response.writeHead(result.statusCode, headers);
    result.pipe(response);
  });
  cloud.on('timeout', () => cloud.destroy(new Error('Upstream timeout')));
  cloud.on('error', error => {
    if (response.headersSent) return response.destroy();
    response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Aliyun HTTPS request failed: ' + error.message);
  });
  response.on('close', () => cloud.destroy());
  request.pipe(cloud);
}

http.createServer(async (request, response) => {
  const address = '127.0.0.1:' + port;
  const allowedHosts = [address, '127.0.0.1:5501'];
  if (!allowedHosts.includes(request.headers.host) ||
      (request.headers.origin && !allowedHosts.some(host => request.headers.origin === 'http://' + host)) ||
      request.headers['sec-fetch-site'] === 'cross-site') {
    response.writeHead(403).end();
    return;
  }
  try {
    const url = new URL(request.url, 'http://' + address);
    if (url.origin !== 'http://' + address) return response.writeHead(400).end();
    if (url.pathname === '/deployment-config.js' ||
        url.pathname.startsWith('/api/v1/') || url.pathname.startsWith('/auth/v1/')) {
      proxy(request, response, url);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
    const parts = decodeURIComponent(url.pathname).split(/[\\/]/).filter(Boolean);
    if (parts.some(part => part.startsWith('.')) ||
        /^(business-api|linux|server|supabase_SQL|supabase|tools|node_modules)$/i.test(parts[0] || '')) {
      return response.writeHead(404).end();
    }
    let file = await fs.promises.realpath(path.join(root, ...parts));
    if ((await fs.promises.stat(file)).isDirectory()) file = await fs.promises.realpath(path.join(file, 'index.html'));
    if (!file.startsWith(root + path.sep) || !(await fs.promises.stat(file)).isFile()) {
      return response.writeHead(404).end();
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => {
  console.log('Local Aliyun preview: http://127.0.0.1:' + port);
});
