import { ByteReader, ByteWriter, bytesEqual, concatBytes, fromHex, toHex } from './bytes';

describe('ByteWriter', () => {
  it('writes little-endian integers by default', () => {
    const data = new ByteWriter().u16(0x1234).u32(0xdeadbeef).data();
    expect(toHex(data)).toBe('3412efbeadde');
  });

  it('writes big-endian integers on request', () => {
    expect(toHex(new ByteWriter().u16be(0x1234).u32be(0xdeadbeef).data())).toBe('1234deadbeef');
  });

  it('writes 64-bit values through BigInt', () => {
    expect(toHex(new ByteWriter().u64(0x0102030405060708n).data())).toBe('0807060504030201');
  });

  it('grows past its initial capacity', () => {
    // Reallocating swaps out the internal DataView; writing through a stale reference
    // used to throw once a packet outgrew its first buffer.
    const writer = new ByteWriter(8);
    for (let i = 0; i < 100; i++) {
      writer.u32(i);
    }
    expect(writer.size).toBe(400);
    expect(new ByteReader(writer.data()).u32()).toBe(0);
  });

  it('grows correctly when a single write exceeds a doubling', () => {
    const writer = new ByteWriter(4);
    writer.bytes(new Uint8Array(1000).fill(0xab));
    expect(writer.size).toBe(1000);
    expect(writer.data()[999]).toBe(0xab);
  });

  it('writes NUL-terminated strings', () => {
    expect(toHex(new ByteWriter().cstring('AB').data())).toBe('414200');
  });

  it('pads fixed-width strings and truncates overlong ones', () => {
    expect(toHex(new ByteWriter().fixedString('AB', 4).data())).toBe('41420000');
    expect(toHex(new ByteWriter().fixedString('ABCDEF', 3).data())).toBe('414243');
  });

  it('writes four-byte tags back-to-front, as the auth handshake expects', () => {
    expect(toHex(new ByteWriter().reversedTag('WoW').data())).toBe('00576f57');
    expect(toHex(new ByteWriter().reversedTag('enUS').data())).toBe('53556e65');
    expect(toHex(new ByteWriter().reversedTag('x86').data())).toBe('00363878');
  });
});

describe('ByteReader', () => {
  it('round-trips through the writer', () => {
    const data = new ByteWriter()
      .u8(1)
      .u16(0x2233)
      .u32(0x44556677)
      .u64(0x8899aabbccddeeffn)
      .f32(1.5)
      .cstring('hello')
      .data();

    const reader = new ByteReader(data);
    expect(reader.u8()).toBe(1);
    expect(reader.u16()).toBe(0x2233);
    expect(reader.u32()).toBe(0x44556677);
    expect(reader.u64()).toBe(0x8899aabbccddeeffn);
    expect(reader.f32()).toBe(1.5);
    expect(reader.cstring()).toBe('hello');
    expect(reader.remaining).toBe(0);
  });

  it('reads big-endian sizes, as world headers use', () => {
    expect(new ByteReader(fromHex('1234')).u16be()).toBe(0x1234);
  });

  it('throws rather than reading past the end', () => {
    expect(() => new ByteReader(fromHex('0102')).u32()).toThrow(RangeError);
  });

  it('throws on an unterminated cstring instead of consuming the stream', () => {
    // A malformed packet should fail loudly, not silently swallow the next packet.
    expect(() => new ByteReader(fromHex('414243')).cstring()).toThrow(/unterminated/);
  });

  it('strips trailing NULs from fixed-width strings', () => {
    expect(new ByteReader(fromHex('41420000')).fixedString(4)).toBe('AB');
  });

  it('tracks its offset across reads', () => {
    const reader = new ByteReader(fromHex('01020304'));
    reader.u16();
    expect(reader.offset).toBe(2);
    expect(reader.remaining).toBe(2);
  });
});

describe('packed GUIDs', () => {
  it('round-trips a sparse GUID', () => {
    const guid = 0x0000000100000001n;
    const packed = new ByteWriter().packedGuid(guid).data();
    // mask + two non-zero bytes
    expect(packed.length).toBe(3);
    expect(new ByteReader(packed).packedGuid()).toBe(guid);
  });

  it('encodes zero as a bare mask byte', () => {
    const packed = new ByteWriter().packedGuid(0n).data();
    expect(toHex(packed)).toBe('00');
    expect(new ByteReader(packed).packedGuid()).toBe(0n);
  });

  it('round-trips a dense GUID', () => {
    const guid = 0xf130000123456789n;
    const packed = new ByteWriter().packedGuid(guid).data();
    expect(new ByteReader(packed).packedGuid()).toBe(guid);
  });
});

describe('hex helpers', () => {
  it('round-trips', () => {
    expect(toHex(fromHex('deadbeef'))).toBe('deadbeef');
  });

  it('ignores whitespace and colons', () => {
    expect(toHex(fromHex('de ad:be ef'))).toBe('deadbeef');
  });

  it('rejects odd-length input', () => {
    expect(() => fromHex('abc')).toThrow(/even length/);
  });
});

describe('byte helpers', () => {
  it('concatenates chunks', () => {
    expect(toHex(concatBytes(fromHex('0102'), fromHex('0304')))).toBe('01020304');
  });

  it('compares contents, not identity', () => {
    expect(bytesEqual(fromHex('0102'), fromHex('0102'))).toBe(true);
    expect(bytesEqual(fromHex('0102'), fromHex('0103'))).toBe(false);
    expect(bytesEqual(fromHex('0102'), fromHex('010203'))).toBe(false);
  });
});
