import { Transport } from './Transport';

export type WebSocketTransportOptions = {
  /**
   * Builds the bridge URL for a target the realm list handed us. The browser never
   * dials host:port itself - it asks the bridge to.
   */
  bridgeUrl: (host: string, port: number) => string;
};

/**
 * Browser transport: WebSocket to a local ws-to-tcp bridge.
 */
export class WebSocketTransport implements Transport {
  private socket: WebSocket | null = null;
  private dataHandler: ((bytes: Uint8Array) => void) | null = null;
  private closeHandler: ((error?: Error) => void) | null = null;
  private readonly options: WebSocketTransportOptions;

  constructor(options: WebSocketTransportOptions) {
    this.options = options;
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.options.bridgeUrl(host, port));
      socket.binaryType = 'arraybuffer';
      this.socket = socket;

      let opened = false;

      socket.onopen = () => {
        opened = true;
        resolve();
      };

      socket.onmessage = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          this.dataHandler?.(new Uint8Array(event.data));
        }
      };

      socket.onerror = () => {
        // The browser deliberately withholds the reason for a WebSocket failure, so
        // there is nothing more specific to report here.
        if (!opened) {
          reject(new Error(`could not reach the bridge for ${host}:${port}`));
        }
      };

      socket.onclose = (event: CloseEvent) => {
        this.socket = null;
        if (!opened) {
          reject(new Error(`bridge connection to ${host}:${port} closed before opening`));
          return;
        }
        this.closeHandler?.(event.wasClean ? undefined : new Error(`bridge closed: ${event.code}`));
      };
    });
  }

  send(bytes: Uint8Array): void {
    if (!this.connected) {
      throw new Error('cannot send on a closed transport');
    }
    // Copy into a standalone buffer: the caller may reuse or mutate theirs, and the
    // send is asynchronous.
    this.socket!.send(bytes.slice().buffer as ArrayBuffer);
  }

  onData(handler: (bytes: Uint8Array) => void): void {
    this.dataHandler = handler;
  }

  onClose(handler: (error?: Error) => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
