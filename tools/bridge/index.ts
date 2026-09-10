// WebSocket-to-TCP bridge.
//
// Browsers cannot open raw TCP sockets, so every packet the browser client sends has to
// pass through something that can. This relays binary WebSocket frames to a TCP socket
// and back, one socket per connection.
//
//   npm run bridge
//   ws://<host>:8765/?target=127.0.0.1:3724
//
// Targets are allowlisted (WOWSER_BRIDGE_TARGETS) so this cannot be used as an open
// proxy by anything that reaches the port.

import net from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.WOWSER_BRIDGE_PORT ?? 8765);
const HOST = process.env.WOWSER_BRIDGE_HOST ?? '0.0.0.0';
const ALLOWED = (process.env.WOWSER_BRIDGE_TARGETS ?? '127.0.0.1:3724,127.0.0.1:8085')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const timestamp = () => new Date().toISOString().slice(11, 23);
const log = (...parts: unknown[]) => console.log(`[${timestamp()}]`, ...parts);

const server = new WebSocketServer({ host: HOST, port: PORT });

let nextId = 1;

server.on('connection', (socket: WebSocket, request) => {
  const id = nextId++;
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const target = url.searchParams.get('target') ?? '';
  const peer = request.socket.remoteAddress ?? 'unknown';

  if (!ALLOWED.includes(target)) {
    log(`#${id} ${peer} rejected: target '${target}' is not allowlisted`);
    // 1008 = policy violation
    socket.close(1008, 'target not allowed');
    return;
  }

  const separator = target.lastIndexOf(':');
  const host = target.slice(0, separator);
  const port = Number(target.slice(separator + 1));

  log(`#${id} ${peer} -> ${target}`);

  const upstream = net.createConnection({ host, port });
  upstream.setNoDelay(true);

  // Frames that arrive before the TCP socket finishes connecting would otherwise be
  // dropped on the floor.
  const backlog: Buffer[] = [];
  let upstreamReady = false;
  let bytesUp = 0;
  let bytesDown = 0;

  upstream.on('connect', () => {
    upstreamReady = true;
    for (const chunk of backlog.splice(0)) {
      upstream.write(chunk);
    }
  });

  upstream.on('data', (chunk: Buffer) => {
    bytesDown += chunk.length;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(chunk);
    }
  });

  upstream.on('error', (error: Error) => {
    log(`#${id} upstream error: ${error.message}`);
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1011, 'upstream error');
    }
  });

  upstream.on('close', () => {
    log(`#${id} upstream closed (up ${bytesUp}B, down ${bytesDown}B)`);
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1000, 'upstream closed');
    }
  });

  socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    const chunk = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.from(data as unknown as Uint8Array);
    bytesUp += chunk.length;
    if (upstreamReady) {
      upstream.write(chunk);
    } else {
      backlog.push(chunk);
    }
  });

  socket.on('close', () => {
    log(`#${id} client closed`);
    upstream.destroy();
  });

  socket.on('error', (error: Error) => {
    log(`#${id} client error: ${error.message}`);
    upstream.destroy();
  });
});

server.on('listening', () => {
  log(`bridge listening on ws://${HOST}:${PORT}`);
  log(`allowed targets: ${ALLOWED.join(', ')}`);
});

server.on('error', (error: Error) => {
  console.error(`bridge failed: ${error.message}`);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log('shutting down');
    server.close(() => process.exit(0));
  });
}
