// Binary readers/writers over Uint8Array.
//
// WoW is little-endian on the wire almost everywhere; the exceptions (world packet header
// sizes, and the SRP big numbers which are LE byte arrays of a big-endian number) get
// explicit helpers rather than a mutable "endianness" flag.

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

export class ByteReader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  offset: number;

  constructor(bytes: Uint8Array, offset = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private take(size: number): number {
    const at = this.offset;
    if (at + size > this.bytes.length) {
      throw new RangeError(`read of ${size} at ${at} exceeds buffer of ${this.bytes.length}`);
    }
    this.offset = at + size;
    return at;
  }

  u8(): number {
    return this.view.getUint8(this.take(1));
  }

  i8(): number {
    return this.view.getInt8(this.take(1));
  }

  u16(): number {
    return this.view.getUint16(this.take(2), true);
  }

  u16be(): number {
    return this.view.getUint16(this.take(2), false);
  }

  u32(): number {
    return this.view.getUint32(this.take(4), true);
  }

  u32be(): number {
    return this.view.getUint32(this.take(4), false);
  }

  i32(): number {
    return this.view.getInt32(this.take(4), true);
  }

  u64(): bigint {
    return this.view.getBigUint64(this.take(8), true);
  }

  f32(): number {
    return this.view.getFloat32(this.take(4), true);
  }

  f64(): number {
    return this.view.getFloat64(this.take(8), true);
  }

  // Returns a view into the underlying buffer - cheap, but aliases the source.
  bytesRef(size: number): Uint8Array {
    return this.bytes.subarray(this.take(size), this.offset);
  }

  // Returns an independent copy.
  read(size: number): Uint8Array {
    return this.bytes.slice(this.take(size), this.offset);
  }

  // NUL-terminated string. Throws rather than running off the end of the buffer, so a
  // malformed packet fails loudly instead of silently consuming the rest of the stream.
  cstring(): string {
    const start = this.offset;
    let end = start;
    while (end < this.bytes.length && this.bytes[end] !== 0) {
      end++;
    }
    if (end >= this.bytes.length) {
      throw new RangeError(`unterminated cstring at ${start}`);
    }
    this.offset = end + 1;
    return textDecoder.decode(this.bytes.subarray(start, end));
  }

  // Fixed-width string field; trailing NULs are stripped.
  fixedString(size: number): string {
    const raw = this.bytesRef(size);
    let end = raw.length;
    while (end > 0 && raw[end - 1] === 0) {
      end--;
    }
    return textDecoder.decode(raw.subarray(0, end));
  }

  // Packed GUID: a mask byte, then one byte per set bit (LSB first) of the non-zero
  // bytes of the u64.
  packedGuid(): bigint {
    const mask = this.u8();
    let guid = 0n;
    for (let i = 0; i < 8; i++) {
      if ((mask & (1 << i)) !== 0) {
        guid |= BigInt(this.u8()) << BigInt(i * 8);
      }
    }
    return guid;
  }
}

export class ByteWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private length = 0;

  constructor(capacity = 64) {
    this.buffer = new Uint8Array(capacity);
    this.view = new DataView(this.buffer.buffer);
  }

  get size(): number {
    return this.length;
  }

  // Reserves `size` bytes and returns the offset to write at. Reallocating replaces
  // `this.view`, so callers must capture the returned offset into a local before
  // touching `this.view` - `this.view.setUint32(this.grow(4), ...)` reads the stale view,
  // because JavaScript evaluates the member expression before the argument.
  private grow(size: number): number {
    const at = this.length;
    const needed = at + size;
    if (needed > this.buffer.length) {
      let capacity = this.buffer.length * 2 || 64;
      while (capacity < needed) {
        capacity *= 2;
      }
      const grown = new Uint8Array(capacity);
      grown.set(this.buffer.subarray(0, at));
      this.buffer = grown;
      this.view = new DataView(grown.buffer);
    }
    this.length = needed;
    return at;
  }

  u8(value: number): this {
    const at = this.grow(1);
    this.view.setUint8(at, value);
    return this;
  }

  u16(value: number): this {
    const at = this.grow(2);
    this.view.setUint16(at, value, true);
    return this;
  }

  u16be(value: number): this {
    const at = this.grow(2);
    this.view.setUint16(at, value, false);
    return this;
  }

  u32(value: number): this {
    const at = this.grow(4);
    this.view.setUint32(at, value, true);
    return this;
  }

  u32be(value: number): this {
    const at = this.grow(4);
    this.view.setUint32(at, value, false);
    return this;
  }

  u64(value: bigint): this {
    const at = this.grow(8);
    this.view.setBigUint64(at, value, true);
    return this;
  }

  f32(value: number): this {
    const at = this.grow(4);
    this.view.setFloat32(at, value, true);
    return this;
  }

  bytes(value: Uint8Array): this {
    const at = this.grow(value.length);
    this.buffer.set(value, at);
    return this;
  }

  // Raw string bytes, no terminator.
  string(value: string): this {
    return this.bytes(textEncoder.encode(value));
  }

  cstring(value: string): this {
    return this.string(value).u8(0);
  }

  // Fixed-width field, NUL-padded or truncated to `size`.
  fixedString(value: string, size: number): this {
    const raw = textEncoder.encode(value).subarray(0, size);
    const at = this.grow(size);
    this.buffer.fill(0, at, at + size);
    this.buffer.set(raw, at);
    return this;
  }

  // 4-byte tag written back-to-front, which is how the client sends gamename/platform/
  // os/country and how the server reads them (see AuthSession::HandleLogonChallenge,
  // which std::reverse-es them back).
  reversedTag(value: string): this {
    const raw = textEncoder.encode(value);
    const at = this.grow(4);
    this.buffer.fill(0, at, at + 4);
    for (let i = 0; i < raw.length && i < 4; i++) {
      this.buffer[at + 3 - i] = raw[i]!;
    }
    return this;
  }

  zeros(count: number): this {
    const at = this.grow(count);
    this.buffer.fill(0, at, at + count);
    return this;
  }

  packedGuid(guid: bigint): this {
    let mask = 0;
    const parts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const byte = Number((guid >> BigInt(i * 8)) & 0xffn);
      if (byte !== 0) {
        mask |= 1 << i;
        parts.push(byte);
      }
    }
    this.u8(mask);
    for (const byte of parts) {
      this.u8(byte);
    }
    return this;
  }

  data(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const fromHex = (hex: string): Uint8Array => {
  const clean = hex.replace(/[\s:]/g, '');
  if (clean.length % 2 !== 0) {
    throw new Error('hex string must have an even length');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
};

export const concatBytes = (...chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
};
