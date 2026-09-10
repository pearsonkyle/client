import { fromHex, toHex } from '../bytes';
import { HeaderCrypt, WorldFrameReader, writeClientHeader } from './header';
import { Opcode } from './opcodes';

describe('writeClientHeader', () => {
  it('writes a big-endian size that counts the opcode', () => {
    const header = writeClientHeader(Opcode.CMSG_CHAR_ENUM, 0);
    // size = 4 (opcode only), big-endian
    expect(header[0]).toBe(0x00);
    expect(header[1]).toBe(0x04);
    // opcode little-endian, 4 bytes
    expect(toHex(header.subarray(2))).toBe('37000000');
  });

  it('counts the payload in the size', () => {
    const header = writeClientHeader(Opcode.CMSG_PLAYER_LOGIN, 8);
    expect((header[0]! << 8) | header[1]!).toBe(12);
  });

  it('is always six bytes', () => {
    expect(writeClientHeader(Opcode.CMSG_PING, 8).length).toBe(6);
  });
});

describe('WorldFrameReader', () => {
  // size is big-endian and counts the 2-byte opcode; opcode is little-endian.
  const serverPacket = (opcode: number, payload: Uint8Array): Uint8Array => {
    const size = payload.length + 2;
    const packet = new Uint8Array(4 + payload.length);
    packet[0] = (size >> 8) & 0xff;
    packet[1] = size & 0xff;
    packet[2] = opcode & 0xff;
    packet[3] = (opcode >> 8) & 0xff;
    packet.set(payload, 4);
    return packet;
  };

  it('reads a single unencrypted packet', () => {
    const reader = new WorldFrameReader();
    reader.append(serverPacket(Opcode.SMSG_AUTH_CHALLENGE, fromHex('01020304')));

    const packets = [...reader.packets()];
    expect(packets).toHaveLength(1);
    expect(packets[0]!.opcode).toBe(Opcode.SMSG_AUTH_CHALLENGE);
    expect(toHex(packets[0]!.payload)).toBe('01020304');
  });

  it('reads several packets from one chunk', () => {
    const reader = new WorldFrameReader();
    const a = serverPacket(Opcode.SMSG_PONG, fromHex('aabbccdd'));
    const b = serverPacket(Opcode.SMSG_MOTD, fromHex('11'));
    const both = new Uint8Array(a.length + b.length);
    both.set(a);
    both.set(b, a.length);
    reader.append(both);

    expect([...reader.packets()].map((p) => p.opcode)).toEqual([Opcode.SMSG_PONG, Opcode.SMSG_MOTD]);
  });

  it('waits for a packet split across reads', () => {
    const reader = new WorldFrameReader();
    const packet = serverPacket(Opcode.SMSG_MOTD, fromHex('deadbeefcafe'));

    // Split inside the header, which is where a naive reader breaks.
    reader.append(packet.subarray(0, 3));
    expect([...reader.packets()]).toHaveLength(0);

    reader.append(packet.subarray(3, 6));
    expect([...reader.packets()]).toHaveLength(0);

    reader.append(packet.subarray(6));
    const packets = [...reader.packets()];
    expect(packets).toHaveLength(1);
    expect(toHex(packets[0]!.payload)).toBe('deadbeefcafe');
  });

  it('reads a byte at a time', () => {
    const reader = new WorldFrameReader();
    const packet = serverPacket(Opcode.SMSG_PONG, fromHex('0102030405'));
    const seen = [];
    for (const byte of packet) {
      reader.append(new Uint8Array([byte]));
      seen.push(...reader.packets());
    }
    expect(seen).toHaveLength(1);
    expect(toHex(seen[0]!.payload)).toBe('0102030405');
  });

  it('reads a large packet with a five-byte header', () => {
    const reader = new WorldFrameReader();
    const payload = new Uint8Array(0x8000).fill(0x5a);
    const size = payload.length + 2;
    const header = new Uint8Array([
      0x80 | ((size >> 16) & 0xff),
      (size >> 8) & 0xff,
      size & 0xff,
      Opcode.SMSG_UPDATE_OBJECT & 0xff,
      (Opcode.SMSG_UPDATE_OBJECT >> 8) & 0xff,
    ]);
    reader.append(header);
    reader.append(payload);

    const packets = [...reader.packets()];
    expect(packets).toHaveLength(1);
    expect(packets[0]!.opcode).toBe(Opcode.SMSG_UPDATE_OBJECT);
    expect(packets[0]!.payload.length).toBe(0x8000);
  });

  it('decrypts headers once crypt is enabled', () => {
    const sessionKey = new Uint8Array(40).fill(0x42);
    const packet = serverPacket(Opcode.SMSG_MOTD, fromHex('1234'));

    // RC4 is XOR with a keystream, so decrypting zero bytes yields the keystream itself.
    // A second HeaderCrypt keyed identically therefore lets us produce exactly what the
    // server would have sent.
    const serverSide = new HeaderCrypt(sessionKey);
    const keystream = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      keystream[i] = serverSide.decryptByte(0);
    }

    const encrypted = new Uint8Array(packet);
    for (let i = 0; i < 4; i++) {
      encrypted[i] = packet[i]! ^ keystream[i]!;
    }

    const reader = new WorldFrameReader();
    reader.enableCrypt(new HeaderCrypt(sessionKey));

    reader.append(encrypted);
    const packets = [...reader.packets()];
    expect(packets).toHaveLength(1);
    expect(packets[0]!.opcode).toBe(Opcode.SMSG_MOTD);
    expect(toHex(packets[0]!.payload)).toBe('1234');
  });

  it('rejects an impossible size', () => {
    const reader = new WorldFrameReader();
    // size = 1, which is smaller than the opcode it is supposed to count
    reader.append(fromHex('00010000'));
    expect(() => [...reader.packets()]).toThrow(/impossible size/);
  });
});

describe('HeaderCrypt', () => {
  it('derives different streams for each direction', () => {
    const key = new Uint8Array(40).fill(7);
    const crypt = new HeaderCrypt(key);
    const encrypted = crypt.encryptHeader(new Uint8Array(4));
    const decrypted = [0, 0, 0, 0].map(() => crypt.decryptByte(0));
    expect(toHex(encrypted)).not.toBe(toHex(Uint8Array.from(decrypted)));
  });

  it('produces a stable keystream for a given session key', () => {
    const key = new Uint8Array(40).fill(7);
    const a = new HeaderCrypt(key).encryptHeader(new Uint8Array(6));
    const b = new HeaderCrypt(key).encryptHeader(new Uint8Array(6));
    expect(toHex(a)).toBe(toHex(b));
  });

  it('does not repeat keystream across successive headers', () => {
    const crypt = new HeaderCrypt(new Uint8Array(40).fill(9));
    const first = toHex(crypt.encryptHeader(new Uint8Array(6)));
    const second = toHex(crypt.encryptHeader(new Uint8Array(6)));
    expect(first).not.toBe(second);
  });
});
