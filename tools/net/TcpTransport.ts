import net from 'node:net';

import { Transport } from '../../src/net/transport/Transport';

/**
 * Node transport: a plain TCP socket.
 *
 * The browser cannot do this - it goes through the WebSocket bridge instead - but every
 * layer above the transport is the same code, so the headless CLI exercises exactly what
 * the browser will run.
 */
export class TcpTransport implements Transport {
  private socket: net.Socket | null = null;
  private dataHandler: ((bytes: Uint8Array) => void) | null = null;
  private closeHandler: ((error?: Error) => void) | null = null;

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      socket.setNoDelay(true);
      this.socket = socket;

      let opened = false;

      socket.once('connect', () => {
        opened = true;
        resolve();
      });

      socket.on('data', (chunk: Buffer) => {
        this.dataHandler?.(new Uint8Array(chunk));
      });

      socket.on('error', (error: Error) => {
        if (!opened) {
          reject(error);
          return;
        }
        this.closeHandler?.(error);
      });

      socket.on('close', () => {
        this.socket = null;
        if (opened) {
          this.closeHandler?.();
        }
      });
    });
  }

  send(bytes: Uint8Array): void {
    if (!this.connected) {
      throw new Error('cannot send on a closed transport');
    }
    this.socket!.write(Buffer.from(bytes));
  }

  onData(handler: (bytes: Uint8Array) => void): void {
    this.dataHandler = handler;
  }

  onClose(handler: (error?: Error) => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.socket?.end();
    this.socket = null;
  }
}
