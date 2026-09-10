// World packet framing and header encryption (TCP 8085).
//
// Client -> server: uint16 size (big-endian, counting the 4-byte opcode), uint32 opcode
// (little-endian). Server -> client: uint16 size (big-endian, counting the 2-byte
// opcode), uint16 opcode (little-endian) - or, when size > 0x7FFF, a five-byte header
// whose first byte has the high bit set and carries the top 8 bits of the size.
//
// Once the session is encrypted only the headers are ciphered; payloads stay plaintext.
// See ServerPktHeader.h, WorldSocket::ReadHeaderHandler and AuthCrypt.cpp.

import { hmacSha1 } from '../crypto/sha1';
import { Rc4 } from '../crypto/rc4';
import { FrameBuffer } from '../transport/Transport';

export const CLIENT_HEADER_SIZE = 6;

// AuthCrypt::Init. Named from the client's point of view: we encrypt what we send and
// decrypt what we receive, which is the mirror of the server's naming.
const CLIENT_ENCRYPT_KEY = new Uint8Array([
  0xc2, 0xb3, 0x72, 0x3c, 0xc6, 0xae, 0xd9, 0xb5, 0x34, 0x3c, 0x53, 0xee, 0x2f, 0x43, 0x67, 0xce,
]);
const SERVER_DECRYPT_KEY = new Uint8Array([
  0xcc, 0x98, 0xae, 0x04, 0xe8, 0x97, 0xea, 0xca, 0x12, 0xdd, 0xc0, 0x93, 0x42, 0x91, 0x53, 0x57,
]);

/** Largest payload the server will accept; anything bigger is dropped as malformed. */
export const MAX_CLIENT_PACKET_SIZE = 10240;

export class HeaderCrypt {
  private readonly encryptCipher: Rc4;
  private readonly decryptCipher: Rc4;
  private readonly scratch = new Uint8Array(1);

  constructor(sessionKey: Uint8Array) {
    this.encryptCipher = new Rc4(hmacSha1(CLIENT_ENCRYPT_KEY, sessionKey));
    this.decryptCipher = new Rc4(hmacSha1(SERVER_DECRYPT_KEY, sessionKey));
    // ARC4-drop1024 on both directions.
    this.encryptCipher.drop(1024);
    this.decryptCipher.drop(1024);
  }

  encryptHeader(header: Uint8Array): Uint8Array {
    return this.encryptCipher.process(header);
  }

  /**
   * Decrypts a single received byte.
   *
   * Server headers are 4 or 5 bytes and which one is only knowable after the first byte
   * is in the clear, so decryption has to proceed a byte at a time. RC4 is a stream
   * cipher: bytes must be decrypted exactly once, in order, or the whole session
   * desynchronises.
   */
  decryptByte(byte: number): number {
    this.scratch[0] = byte;
    this.decryptCipher.process(this.scratch);
    return this.scratch[0]!;
  }
}

export const writeClientHeader = (opcode: number, payloadLength: number): Uint8Array => {
  const header = new Uint8Array(CLIENT_HEADER_SIZE);
  // size counts the opcode, and is big-endian
  const size = payloadLength + 4;
  header[0] = (size >> 8) & 0xff;
  header[1] = size & 0xff;
  header[2] = opcode & 0xff;
  header[3] = (opcode >> 8) & 0xff;
  header[4] = (opcode >> 16) & 0xff;
  header[5] = (opcode >> 24) & 0xff;
  return header;
};

export type WorldPacket = {
  opcode: number;
  payload: Uint8Array;
};

/**
 * Turns the inbound byte stream into whole world packets, decrypting headers as it goes.
 *
 * Header bytes are pulled one at a time and decrypted immediately, because RC4 state
 * cannot be rewound: a header that is half-arrived must keep its decrypted prefix until
 * the rest shows up.
 */
export class WorldFrameReader {
  private readonly frames = new FrameBuffer();
  private crypt: HeaderCrypt | null = null;
  private headerBytes: number[] = [];
  private headerLength: number | null = null;
  private pending: { opcode: number; bodyLength: number } | null = null;

  /** Turns on header decryption. Called right after CMSG_AUTH_SESSION is sent. */
  enableCrypt(crypt: HeaderCrypt): void {
    this.crypt = crypt;
  }

  append(chunk: Uint8Array): void {
    this.frames.append(chunk);
  }

  *packets(): Generator<WorldPacket> {
    for (;;) {
      if (this.pending === null) {
        while (this.headerLength === null || this.headerBytes.length < this.headerLength) {
          const next = this.frames.take(1);
          if (next === null) {
            return;
          }
          const byte = this.crypt ? this.crypt.decryptByte(next[0]!) : next[0]!;
          this.headerBytes.push(byte);
          if (this.headerBytes.length === 1) {
            this.headerLength = (byte & 0x80) !== 0 ? 5 : 4;
          }
        }

        const h = this.headerBytes;
        let size: number;
        let opcode: number;
        if (this.headerLength === 5) {
          size = ((h[0]! & 0x7f) << 16) | (h[1]! << 8) | h[2]!;
          opcode = h[3]! | (h[4]! << 8);
        } else {
          size = (h[0]! << 8) | h[1]!;
          opcode = h[2]! | (h[3]! << 8);
        }

        if (size < 2) {
          throw new Error(`server sent a packet with an impossible size (${size})`);
        }

        // size counts the 2-byte opcode
        this.pending = { opcode, bodyLength: size - 2 };
        this.headerBytes = [];
        this.headerLength = null;
      }

      const body = this.frames.take(this.pending.bodyLength);
      if (body === null) {
        return;
      }

      yield { opcode: this.pending.opcode, payload: body.slice() };
      this.pending = null;
    }
  }
}
