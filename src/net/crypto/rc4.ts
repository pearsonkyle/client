// RC4, used for world-packet header encryption.
//
// Node's OpenSSL 3 dropped RC4 from the default provider, so crypto.createCipheriv('rc4')
// is not an option, and the browser has never had it. It is twenty lines anyway.

export class Rc4 {
  private readonly state: Uint8Array;
  private i = 0;
  private j = 0;

  constructor(key: Uint8Array) {
    const state = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      state[i] = i;
    }
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + state[i]! + key[i % key.length]!) & 0xff;
      const swap = state[i]!;
      state[i] = state[j]!;
      state[j] = swap;
    }
    this.state = state;
  }

  // XORs `data` with the keystream in place and returns it.
  process(data: Uint8Array): Uint8Array {
    const { state } = this;
    let { i, j } = this;
    for (let n = 0; n < data.length; n++) {
      i = (i + 1) & 0xff;
      j = (j + state[i]!) & 0xff;
      const swap = state[i]!;
      state[i] = state[j]!;
      state[j] = swap;
      data[n] = data[n]! ^ state[(state[i]! + state[j]!) & 0xff]!;
    }
    this.i = i;
    this.j = j;
    return data;
  }

  // Advances the keystream without producing output. WotLK drops 1024 bytes after
  // keying both directions.
  drop(count: number): void {
    this.process(new Uint8Array(count));
  }
}
