// Synchronous SHA-1 over Uint8Array.
//
// The SRP6 exchange chains a dozen hashes together and the world-packet digest is built
// mid-packet-write, so an async crypto.subtle wrapper would infect every call site with
// promises for no benefit. SHA-1 is small enough to just implement.

const BLOCK_SIZE = 64;

export const SHA1_DIGEST_LENGTH = 20;

const rotl = (value: number, bits: number): number => (value << bits) | (value >>> (32 - bits));

export const sha1 = (...inputs: Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const input of inputs) {
    total += input.length;
  }

  // message + 0x80 + padding + 8-byte big-endian bit length, rounded up to a block
  const padded = new Uint8Array(Math.ceil((total + 9) / BLOCK_SIZE) * BLOCK_SIZE);
  let at = 0;
  for (const input of inputs) {
    padded.set(input, at);
    at += input.length;
  }
  padded[at] = 0x80;

  const bitLength = BigInt(total) * 8n;
  const view = new DataView(padded.buffer);
  view.setBigUint64(padded.length - 8, bitLength, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Int32Array(80);

  for (let block = 0; block < padded.length; block += BLOCK_SIZE) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getInt32(block + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (rotl(a, 5) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const digest = new Uint8Array(SHA1_DIGEST_LENGTH);
  const out = new DataView(digest.buffer);
  out.setInt32(0, h0, false);
  out.setInt32(4, h1, false);
  out.setInt32(8, h2, false);
  out.setInt32(12, h3, false);
  out.setInt32(16, h4, false);
  return digest;
};

// HMAC-SHA1 (RFC 2104).
export const hmacSha1 = (key: Uint8Array, ...data: Uint8Array[]): Uint8Array => {
  let block = new Uint8Array(BLOCK_SIZE);
  if (key.length > BLOCK_SIZE) {
    block.set(sha1(key));
  } else {
    block.set(key);
  }

  const inner = new Uint8Array(BLOCK_SIZE);
  const outer = new Uint8Array(BLOCK_SIZE);
  for (let i = 0; i < BLOCK_SIZE; i++) {
    inner[i] = block[i]! ^ 0x36;
    outer[i] = block[i]! ^ 0x5c;
  }
  block = new Uint8Array(0);

  return sha1(outer, sha1(inner, ...data));
};
