// Client half of the authserver conversation (TCP 3724).
//
// Flow: LOGON_CHALLENGE -> LOGON_PROOF -> REALM_LIST. Everything is little-endian, and
// the SRP big numbers are little-endian byte arrays. Verified against AzerothCore's
// src/server/apps/authserver/Server/AuthSession.cpp.

import { ByteReader, ByteWriter, toHex } from '../bytes';
import { srp6Proof } from '../crypto/srp6';
import { FrameBuffer, Transport } from '../transport/Transport';
import { AuthOpcode, AuthResult, authResultName, RealmFlag } from './opcodes';

export type ClientBuildInfo = {
  build: number;
  majorVersion: number;
  minorVersion: number;
  patchVersion: number;
  platform: string;
  os: string;
  locale: string;
  timezone: number;
};

export const DEFAULT_BUILD: ClientBuildInfo = {
  build: 12340,
  majorVersion: 3,
  minorVersion: 3,
  patchVersion: 5,
  platform: 'x86',
  // Warden rejects anything but Win/OSX, and we cannot answer Warden, so we always
  // claim Win. The server must be running with Warden.Enabled = 0 regardless.
  os: 'Win',
  locale: 'enUS',
  timezone: 0,
};

export type Realm = {
  type: number;
  locked: boolean;
  flags: number;
  name: string;
  address: string;
  host: string;
  port: number;
  population: number;
  characterCount: number;
  timezone: number;
  id: number;
  build?: string;
  online: boolean;
};

export class AuthError extends Error {
  readonly code: number;

  constructor(code: number, context: string) {
    super(`${context}: ${authResultName(code)} (0x${code.toString(16).padStart(2, '0')})`);
    this.name = 'AuthError';
    this.code = code;
  }
}

/**
 * Determines the length of the auth frame at the front of the buffer.
 *
 * Auth packets are not uniformly length-prefixed - each opcode has its own shape, and
 * two of them vary with their own contents - so framing has to understand the packets.
 */
export const authFrameSize = (buffer: Uint8Array): number | null => {
  const opcode = buffer[0];

  if (opcode === AuthOpcode.LOGON_CHALLENGE) {
    if (buffer.length < 3) {
      return null;
    }
    // cmd, unk, status
    if (buffer[2] !== AuthResult.SUCCESS) {
      return 3;
    }
    // B[32], gLen, g[gLen], NLen, N[NLen], s[32], unk[16], securityFlags
    const gLenAt = 3 + 32;
    if (buffer.length < gLenAt + 1) {
      return null;
    }
    const gLen = buffer[gLenAt]!;
    const nLenAt = gLenAt + 1 + gLen;
    if (buffer.length < nLenAt + 1) {
      return null;
    }
    const nLen = buffer[nLenAt]!;
    return nLenAt + 1 + nLen + 32 + 16 + 1;
  }

  if (opcode === AuthOpcode.LOGON_PROOF) {
    if (buffer.length < 2) {
      return null;
    }
    const error = buffer[1]!;
    if (error === AuthResult.SUCCESS) {
      // cmd, error, M2[20], AccountFlags, SurveyId, LoginFlags
      return 1 + 1 + 20 + 4 + 4 + 2;
    }
    // A version rejection is sent as just cmd+error; every other failure carries a
    // trailing uint16 LoginFlags.
    return error === AuthResult.FAIL_VERSION_INVALID ? 2 : 4;
  }

  if (opcode === AuthOpcode.REALM_LIST) {
    if (buffer.length < 3) {
      return null;
    }
    return 3 + (buffer[1]! | (buffer[2]! << 8));
  }

  throw new Error(`unknown auth opcode 0x${(opcode ?? 0).toString(16)}`);
};

export class AuthClient {
  private readonly transport: Transport;
  private readonly buildInfo: ClientBuildInfo;
  private readonly frames = new FrameBuffer();
  private readonly queue: Uint8Array[] = [];
  private waiter: ((frame: Uint8Array) => void) | null = null;
  private failure: Error | null = null;
  private rejectWaiter: ((error: Error) => void) | null = null;

  /** Account name, uppercased - the form the world server expects in CMSG_AUTH_SESSION. */
  account = '';
  /** 40-byte SRP6 session key, available after a successful login. */
  sessionKey: Uint8Array | null = null;

  onPacket: ((direction: 'send' | 'recv', opcode: number, bytes: Uint8Array) => void) | null = null;

  constructor(transport: Transport, buildInfo: Partial<ClientBuildInfo> = {}) {
    this.transport = transport;
    this.buildInfo = { ...DEFAULT_BUILD, ...buildInfo };

    this.transport.onData((chunk) => this.receive(chunk));
    this.transport.onClose((error) => {
      this.failure = error ?? new Error('auth connection closed');
      this.rejectWaiter?.(this.failure);
      this.waiter = null;
      this.rejectWaiter = null;
    });
  }

  private receive(chunk: Uint8Array): void {
    this.frames.append(chunk);
    for (const frame of this.frames.frames(authFrameSize)) {
      const packet = frame.slice();
      this.onPacket?.('recv', packet[0]!, packet);
      if (this.waiter) {
        const resolve = this.waiter;
        this.waiter = null;
        this.rejectWaiter = null;
        resolve(packet);
      } else {
        this.queue.push(packet);
      }
    }
  }

  private nextFrame(): Promise<Uint8Array> {
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => {
      this.waiter = resolve;
      this.rejectWaiter = reject;
    });
  }

  private send(opcode: number, bytes: Uint8Array): void {
    this.onPacket?.('send', opcode, bytes);
    this.transport.send(bytes);
  }

  /**
   * Runs LOGON_CHALLENGE + LOGON_PROOF and keeps the resulting session key.
   */
  async login(account: string, password: string): Promise<Uint8Array> {
    this.account = account.toUpperCase();

    const { build, majorVersion, minorVersion, patchVersion, platform, os, locale, timezone } =
      this.buildInfo;
    const accountBytes = new TextEncoder().encode(this.account);

    const challenge = new ByteWriter(64)
      .u8(AuthOpcode.LOGON_CHALLENGE)
      // The retail 3.3.5 client sends 8 here; AzerothCore reads the field but ignores it.
      .u8(8)
      .u16(30 + accountBytes.length)
      // gamename/platform/os/country all travel back-to-front.
      .reversedTag('WoW')
      .u8(majorVersion)
      .u8(minorVersion)
      .u8(patchVersion)
      .u16(build)
      .reversedTag(platform)
      .reversedTag(os)
      .reversedTag(locale)
      .u32(timezone)
      // The server uses the socket's address, so this is always zero.
      .u32(0)
      .u8(accountBytes.length)
      .bytes(accountBytes)
      .data();

    this.send(AuthOpcode.LOGON_CHALLENGE, challenge);

    const challengeReply = new ByteReader(await this.nextFrame());
    challengeReply.u8(); // cmd
    challengeReply.u8(); // unused
    const status = challengeReply.u8();
    if (status !== AuthResult.SUCCESS) {
      throw new AuthError(status, 'logon challenge rejected');
    }

    const B = challengeReply.read(32);
    const g = challengeReply.read(challengeReply.u8());
    const N = challengeReply.read(challengeReply.u8());
    const salt = challengeReply.read(32);
    challengeReply.read(16); // version challenge, only used for CRC checks we do not do
    const securityFlags = challengeReply.u8();
    if (securityFlags !== 0) {
      throw new Error(
        `account requires additional authentication (securityFlags 0x${securityFlags.toString(16)}); ` +
          'PIN, matrix and token logins are not supported',
      );
    }

    const proof = srp6Proof(this.account, password, salt, B, N, g);

    const proofPacket = new ByteWriter(80)
      .u8(AuthOpcode.LOGON_PROOF)
      .bytes(proof.A)
      .bytes(proof.M1)
      // CRC of the client binaries; AzerothCore only checks this when it has version
      // hashes configured, which it does not by default.
      .zeros(20)
      .u8(0) // number of keys
      .u8(0) // security flags
      .data();

    this.send(AuthOpcode.LOGON_PROOF, proofPacket);

    const proofReply = new ByteReader(await this.nextFrame());
    proofReply.u8(); // cmd
    const error = proofReply.u8();
    if (error !== AuthResult.SUCCESS) {
      throw new AuthError(error, 'logon proof rejected');
    }

    const serverM2 = proofReply.read(20);
    if (toHex(serverM2) !== toHex(proof.M2)) {
      // A mismatch means we and the server derived different session keys; continuing
      // would fail later at the world server with a useless AUTH_FAILED.
      throw new Error('server proof (M2) did not match - session keys disagree');
    }

    this.sessionKey = proof.sessionKey;
    return proof.sessionKey;
  }

  /**
   * Requests the realm list. Only valid after a successful login (the server requires
   * STATUS_AUTHED for this opcode).
   */
  async realmList(): Promise<Realm[]> {
    if (!this.sessionKey) {
      throw new Error('realmList() requires a completed login');
    }

    this.send(AuthOpcode.REALM_LIST, new ByteWriter(8).u8(AuthOpcode.REALM_LIST).u32(0).data());

    const reply = new ByteReader(await this.nextFrame());
    reply.u8(); // cmd
    reply.u16(); // payload size
    reply.u32(); // unused
    const count = reply.u16();

    const realms: Realm[] = [];
    for (let i = 0; i < count; i++) {
      const type = reply.u8();
      const locked = reply.u8() !== 0;
      const flags = reply.u8();
      const name = reply.cstring();
      const address = reply.cstring();
      const population = reply.f32();
      const characterCount = reply.u8();
      const timezone = reply.u8();
      const id = reply.u8();

      let build: string | undefined;
      if ((flags & RealmFlag.SPECIFYBUILD) !== 0) {
        const major = reply.u8();
        const minor = reply.u8();
        const bugfix = reply.u8();
        build = `${major}.${minor}.${bugfix}.${reply.u16()}`;
      }

      const separator = address.lastIndexOf(':');
      realms.push({
        type,
        locked,
        flags,
        name,
        address,
        host: separator === -1 ? address : address.slice(0, separator),
        port: separator === -1 ? 8085 : Number(address.slice(separator + 1)),
        population,
        characterCount,
        timezone,
        id,
        build,
        online: (flags & RealmFlag.OFFLINE) === 0,
      });
    }

    return realms;
  }
}
