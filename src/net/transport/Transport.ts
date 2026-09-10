// A byte pipe to a server.
//
// The protocol code above this line is identical in the browser and in Node; only the
// way bytes reach the wire differs. The browser cannot open a TCP socket, so it speaks
// to a local WebSocket bridge that relays to the real port; Node connects directly.

export interface Transport {
  connect(host: string, port: number): Promise<void>;
  send(bytes: Uint8Array): void;
  onData(handler: (bytes: Uint8Array) => void): void;
  onClose(handler: (error?: Error) => void): void;
  close(): void;
  readonly connected: boolean;
}

/**
 * Decides how long the frame at the front of `buffer` is.
 *
 * Returns the total frame length in bytes, or null when more bytes are needed before
 * the length can even be determined.
 */
export type FrameSizer = (buffer: Uint8Array) => number | null;

/**
 * Reassembles a byte stream into whole protocol frames.
 *
 * TCP gives no message boundaries: a single read can carry half a packet, or three
 * packets and a fragment. Everything that parses packets goes through here.
 */
export class FrameBuffer {
  private buffer = new Uint8Array(0);

  get available(): number {
    return this.buffer.length;
  }

  append(chunk: Uint8Array): void {
    if (this.buffer.length === 0) {
      this.buffer = chunk.slice();
      return;
    }
    const grown = new Uint8Array(this.buffer.length + chunk.length);
    grown.set(this.buffer);
    grown.set(chunk, this.buffer.length);
    this.buffer = grown;
  }

  /** Pulls off every complete frame currently buffered. */
  *frames(sizer: FrameSizer): Generator<Uint8Array> {
    for (;;) {
      if (this.buffer.length === 0) {
        return;
      }
      const size = sizer(this.buffer);
      if (size === null || this.buffer.length < size) {
        return;
      }
      if (size <= 0) {
        throw new Error(`frame sizer returned a non-positive size (${size})`);
      }
      yield this.buffer.subarray(0, size);
      this.buffer = this.buffer.slice(size);
    }
  }

  /** Removes and returns exactly `size` bytes, or null if they are not all here yet. */
  take(size: number): Uint8Array | null {
    if (this.buffer.length < size) {
      return null;
    }
    const frame = this.buffer.subarray(0, size);
    this.buffer = this.buffer.slice(size);
    return frame;
  }

  /** Reads ahead without consuming. */
  peek(size: number): Uint8Array | null {
    return this.buffer.length < size ? null : this.buffer.subarray(0, size);
  }

  clear(): void {
    this.buffer = new Uint8Array(0);
  }
}
