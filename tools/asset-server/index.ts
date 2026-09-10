// Serves game assets straight out of the client's MPQ chain over HTTP.
//
// This replaces the README's manual "extract Interface/ and convert BLP to PNG" step:
// the browser asks for a path as it appears in the game's XML and Lua, and gets the bytes
// the real client would have loaded.
//
//   npm run asset-server -- --client /path/to/wow-335a [--locale enUS] [--port 8766]
//
// Nothing here is ever committed or exposed beyond the local machine - it is reading
// Blizzard's copyrighted game data off the developer's disk.

import http from 'node:http';
import { createHash } from 'node:crypto';

import { openChain, toMpqPath } from './mpqChain';

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at !== -1 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};

const CLIENT_DIR = flag('client', process.env.WOW_CLIENT) ?? '';
const LOCALE = flag('locale', process.env.WOW_LOCALE ?? 'enUS')!;
const PORT = Number(flag('port', process.env.WOWSER_ASSET_PORT ?? '8766'));
const HOST = flag('host', process.env.WOWSER_ASSET_HOST ?? '0.0.0.0')!;

if (!CLIENT_DIR) {
  console.error('usage: npm run asset-server -- --client /path/to/wow-335a [--locale enUS]');
  process.exit(1);
}

const MIME: Record<string, string> = {
  blp: 'image/x-blp',
  dbc: 'application/octet-stream',
  lua: 'text/plain; charset=utf-8',
  toc: 'text/plain; charset=utf-8',
  xml: 'text/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  ttf: 'font/ttf',
  m2: 'application/octet-stream',
  skin: 'application/octet-stream',
  wmo: 'application/octet-stream',
  adt: 'application/octet-stream',
  wdt: 'application/octet-stream',
  wdl: 'application/octet-stream',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  png: 'image/png',
  jpg: 'image/jpeg',
  html: 'text/html; charset=utf-8',
};

const mimeFor = (path: string): string => {
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
  return MIME[extension] ?? 'application/octet-stream';
};

const main = async () => {
  console.log(`opening MPQ chain from ${CLIENT_DIR} (locale ${LOCALE})`);
  const chain = await openChain(CLIENT_DIR, LOCALE);
  console.log(`  ${chain.archives.length} archives applied`);

  // Reading from the WASM heap is not free and the UI asks for the same textures over
  // and over, so keep recent files around.
  const cache = new Map<string, { body: Uint8Array; etag: string }>();
  const CACHE_LIMIT = 512;

  const load = (mpqPath: string) => {
    const cached = cache.get(mpqPath);
    if (cached) {
      return cached;
    }
    const body = chain.read(mpqPath);
    if (body === null) {
      return null;
    }
    const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
    const entry = { body, etag };
    if (cache.size >= CACHE_LIMIT) {
      // Plain FIFO eviction: good enough, and it keeps the hot working set.
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        cache.delete(oldest);
      }
    }
    cache.set(mpqPath, entry);
    return entry;
  };

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    // The bridge and the asset server sit on different ports from the Vite dev server,
    // so the browser treats them as cross-origin.
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'If-None-Match');

    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    if (url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, locale: LOCALE, archives: chain.archives.length }));
      return;
    }

    // Search the (listfile) of the chain - handy when the XML references a path whose
    // exact spelling is unclear.
    if (url.pathname === '/find') {
      const query = url.searchParams.get('q') ?? '';
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 2000);
      const results = query ? chain.search(query, limit) : [];
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ query, count: results.length, results }));
      return;
    }

    const mpqPath = toMpqPath(url.pathname);
    if (!mpqPath) {
      response.writeHead(404).end('not found');
      return;
    }

    const entry = load(mpqPath);
    if (!entry) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end(`not in MPQ chain: ${mpqPath}`);
      return;
    }

    if (request.headers['if-none-match'] === entry.etag) {
      response.writeHead(304).end();
      return;
    }

    response.writeHead(200, {
      'Content-Type': mimeFor(mpqPath),
      'Content-Length': entry.body.length,
      ETag: entry.etag,
      // Game data never changes under us, so let the browser hold on to it.
      'Cache-Control': 'public, max-age=3600',
    });
    response.end(Buffer.from(entry.body));
  });

  server.listen(PORT, HOST, () => {
    console.log(`asset server listening on http://${HOST}:${PORT}`);
    console.log(`  try: curl -I http://127.0.0.1:${PORT}/Interface/GlueXML/GlueXML.toc`);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => {
        chain.close();
        process.exit(0);
      });
    });
  }
};

main().catch((error: Error) => {
  console.error(`asset server failed: ${error.message}`);
  process.exitCode = 1;
});
