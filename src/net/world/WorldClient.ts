// Client half of the world server conversation (TCP 8085).
//
// Verified against AzerothCore's WorldSocket.cpp, CharacterHandler.cpp and
// ChatHandler.cpp for 3.3.5a / build 12340.

import { ByteReader, ByteWriter, toHex } from '../bytes';
import { sha1 } from '../crypto/sha1';
import { TypedEmitter } from '../TypedEmitter';
import { Transport } from '../transport/Transport';
import { HeaderCrypt, WorldFrameReader, writeClientHeader, WorldPacket } from './header';
import { Opcode, opcodeName } from './opcodes';
import {
  AuthResponse,
  CharacterInfo,
  CharacterItem,
  ChatMessage,
  chatMessageTypeName,
  ChatMessageType,
  CHAT_TYPES_WITH_SENDER_NAME,
  isHorde,
  Language,
  ResponseCode,
  responseCodeName,
  WorldPosition,
} from './types';

/** Equipment slots serialised into every SMSG_CHAR_ENUM entry. */
const CHAR_ENUM_ITEM_SLOTS = 23;

/**
 * WorldSocket::HandlePing treats two pings closer than 27 seconds as "overspeed" and
 * kicks after MaxOverspeedPings (default 2). 30 seconds is the client's own interval and
 * leaves a safe margin.
 */
const PING_INTERVAL_MS = 30_000;

export type WorldClientEvents = {
  authenticated: [AuthResponse];
  queued: [number];
  characters: [CharacterInfo[]];
  enteredWorld: [WorldPosition];
  chat: [ChatMessage];
  motd: [string[]];
  packet: [WorldPacket];
  /** An opcode we have no handler for yet - the backlog for later milestones. */
  unhandled: [WorldPacket];
  disconnected: [Error | undefined];
  error: [Error];
};

export type WorldClientOptions = {
  build?: number;
  /**
   * Platform-specific zlib inflate, for SMSG_COMPRESSED_UPDATE_OBJECT. Node passes
   * zlib.inflateSync; the browser can pass a DecompressionStream wrapper. Without one,
   * compressed updates are counted and skipped rather than failing the session.
   */
  inflate?: (data: Uint8Array) => Uint8Array;
};

export class WorldTimeoutError extends Error {
  constructor(opcode: number, ms: number) {
    super(`timed out after ${ms}ms waiting for ${opcodeName(opcode)}`);
    this.name = 'WorldTimeoutError';
  }
}

export class WorldClient extends TypedEmitter<WorldClientEvents> {
  private readonly transport: Transport;
  private readonly reader = new WorldFrameReader();
  private readonly options: WorldClientOptions;
  private crypt: HeaderCrypt | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingSequence = 0;
  private closed = false;

  /** Opcodes seen with no handler, and how many times - printed at the end of a run. */
  readonly unhandledOpcodes = new Map<number, number>();

  /** Resolved names from CMSG_NAME_QUERY, so we ask once per GUID. */
  private readonly nameCache = new Map<bigint, string>();
  private readonly pendingNameQueries = new Map<bigint, Promise<string>>();

  private readonly waiters = new Map<number, ((packet: WorldPacket) => void)[]>();

  onPacketLog: ((direction: 'send' | 'recv', opcode: number, bytes: Uint8Array) => void) | null =
    null;

  constructor(transport: Transport, options: WorldClientOptions = {}) {
    super();
    this.transport = transport;
    this.options = options;

    this.transport.onData((chunk) => {
      this.reader.append(chunk);
      try {
        for (const packet of this.reader.packets()) {
          this.dispatch(packet);
        }
      } catch (error) {
        this.emit('error', error as Error);
        this.close();
      }
    });

    this.transport.onClose((error) => {
      this.stopKeepalive();
      if (!this.closed) {
        this.closed = true;
        this.emit('disconnected', error);
      }
    });
  }

  // ---------------------------------------------------------------- sending

  send(opcode: number, payload: Uint8Array = new Uint8Array(0)): void {
    const header = writeClientHeader(opcode, payload.length);
    // Only the header is encrypted; the payload travels in the clear.
    const framed = new Uint8Array(header.length + payload.length);
    framed.set(this.crypt ? this.crypt.encryptHeader(header) : header, 0);
    framed.set(payload, header.length);

    this.onPacketLog?.('send', opcode, payload);
    this.transport.send(framed);
  }

  /** Waits for the next packet with `opcode`. */
  waitFor(opcode: number, timeoutMs = 15_000): Promise<WorldPacket> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const list = this.waiters.get(opcode);
        if (list) {
          const at = list.indexOf(settle);
          if (at !== -1) {
            list.splice(at, 1);
          }
        }
        reject(new WorldTimeoutError(opcode, timeoutMs));
      }, timeoutMs);

      const settle = (packet: WorldPacket) => {
        clearTimeout(timer);
        resolve(packet);
      };

      const list = this.waiters.get(opcode);
      if (list) {
        list.push(settle);
      } else {
        this.waiters.set(opcode, [settle]);
      }
    });
  }

  /** Waits for whichever of several opcodes arrives first. */
  private waitForAny(opcodes: number[], timeoutMs = 15_000): Promise<WorldPacket> {
    return Promise.race(opcodes.map((opcode) => this.waitFor(opcode, timeoutMs)));
  }

  // ------------------------------------------------------------- handshake

  /**
   * Completes SMSG_AUTH_CHALLENGE -> CMSG_AUTH_SESSION -> SMSG_AUTH_RESPONSE.
   *
   * `realmId` must match the realm's id from the realm list (and the server's RealmID
   * config), or the server answers REALM_LIST_REALM_NOT_FOUND.
   */
  async authenticate(
    account: string,
    sessionKey: Uint8Array,
    realmId: number,
  ): Promise<AuthResponse> {
    const challenge = new ByteReader((await this.waitFor(Opcode.SMSG_AUTH_CHALLENGE)).payload);
    challenge.u32(); // always 1
    const serverSeed = challenge.read(4);

    const clientSeed = new Uint8Array(4);
    crypto.getRandomValues(clientSeed);

    const upperAccount = account.toUpperCase();
    const accountBytes = new TextEncoder().encode(upperAccount);

    // SHA1(Account || 00 00 00 00 || clientSeed || serverSeed || K)
    const digest = sha1(
      accountBytes,
      new Uint8Array(4),
      clientSeed,
      serverSeed,
      sessionKey,
    );

    const payload = new ByteWriter(128)
      .u32(this.options.build ?? 12340)
      .u32(0) // LoginServerID
      .cstring(upperAccount)
      .u32(0) // LoginServerType
      .bytes(clientSeed)
      .u32(0) // RegionID
      .u32(0) // BattlegroupID
      .u32(realmId)
      .u64(0n) // DosResponse
      .bytes(digest)
      // Addon block. WorldSession::ReadAddonsInfo returns early when the first uint32 is
      // zero, so four zero bytes are accepted in place of a real zlib addon list.
      .u32(0)
      .data();

    // Sent in the clear; the server keys its crypt as soon as it has looked up our
    // session key, so everything after this - including SMSG_AUTH_RESPONSE - is
    // encrypted.
    this.send(Opcode.CMSG_AUTH_SESSION, payload);
    this.crypt = new HeaderCrypt(sessionKey);
    this.reader.enableCrypt(this.crypt);

    for (;;) {
      const response = this.parseAuthResponse(
        (await this.waitFor(Opcode.SMSG_AUTH_RESPONSE)).payload,
      );

      if (response.code === ResponseCode.AUTH_WAIT_QUEUE) {
        this.emit('queued', response.queuePosition ?? 0);
        // The server sends another SMSG_AUTH_RESPONSE when we reach the front.
        continue;
      }

      if (response.code !== ResponseCode.AUTH_OK) {
        throw new Error(`world authentication failed: ${response.codeName}`);
      }

      this.startKeepalive();
      this.emit('authenticated', response);
      return response;
    }
  }

  private parseAuthResponse(payload: Uint8Array): AuthResponse {
    const reader = new ByteReader(payload);
    const code = reader.u8();
    const response: AuthResponse = { code, codeName: responseCodeName(code) };

    if (code === ResponseCode.AUTH_OK) {
      reader.u32(); // billing time remaining
      reader.u8(); // billing plan flags
      reader.u32(); // billing time rested
      response.expansion = reader.u8();
    } else if (code === ResponseCode.AUTH_WAIT_QUEUE) {
      response.queuePosition = reader.u32();
    }

    return response;
  }

  // ------------------------------------------------------------ characters

  async characters(): Promise<CharacterInfo[]> {
    this.send(Opcode.CMSG_CHAR_ENUM);
    const packet = await this.waitFor(Opcode.SMSG_CHAR_ENUM);
    return parseCharEnum(packet.payload);
  }

  async createCharacter(options: {
    name: string;
    race: number;
    class: number;
    gender?: number;
    skin?: number;
    face?: number;
    hairStyle?: number;
    hairColor?: number;
    facialStyle?: number;
    outfitId?: number;
  }): Promise<void> {
    const payload = new ByteWriter(64)
      .cstring(options.name)
      .u8(options.race)
      .u8(options.class)
      .u8(options.gender ?? 0)
      .u8(options.skin ?? 0)
      .u8(options.face ?? 0)
      .u8(options.hairStyle ?? 0)
      .u8(options.hairColor ?? 0)
      .u8(options.facialStyle ?? 0)
      .u8(options.outfitId ?? 0)
      .data();

    this.send(Opcode.CMSG_CHAR_CREATE, payload);

    const reply = await this.waitFor(Opcode.SMSG_CHAR_CREATE);
    const code = new ByteReader(reply.payload).u8();
    if (code !== ResponseCode.CHAR_CREATE_SUCCESS) {
      throw new Error(`character creation failed: ${responseCodeName(code)}`);
    }
  }

  /**
   * Enters the world as `guid`, resolving once the server confirms the position.
   */
  async enterWorld(guid: bigint): Promise<WorldPosition> {
    this.send(Opcode.CMSG_PLAYER_LOGIN, new ByteWriter(8).u64(guid).data());

    const packet = await this.waitForAny(
      [Opcode.SMSG_LOGIN_VERIFY_WORLD, Opcode.SMSG_CHARACTER_LOGIN_FAILED],
      30_000,
    );

    if (packet.opcode === Opcode.SMSG_CHARACTER_LOGIN_FAILED) {
      const reason = new ByteReader(packet.payload).u8();
      throw new Error(`character login failed: ${responseCodeName(reason)}`);
    }

    const reader = new ByteReader(packet.payload);
    const position: WorldPosition = {
      map: reader.u32(),
      x: reader.f32(),
      y: reader.f32(),
      z: reader.f32(),
      orientation: reader.f32(),
    };

    this.emit('enteredWorld', position);
    return position;
  }

  // ------------------------------------------------------------------ chat

  /**
   * Sends a chat message.
   *
   * LANG_UNIVERSAL is GM-only, so a normal character must speak its faction's language
   * or the server silently drops the message.
   */
  say(text: string, race: number, type = ChatMessageType.SAY): void {
    const language = isHorde(race) ? Language.ORCISH : Language.COMMON;
    const payload = new ByteWriter(64).u32(type).u32(language).cstring(text).data();
    this.send(Opcode.CMSG_MESSAGECHAT, payload);
  }

  /** Resolves a GUID to a character name, asking the server at most once per GUID. */
  async nameQuery(guid: bigint): Promise<string> {
    const cached = this.nameCache.get(guid);
    if (cached !== undefined) {
      return cached;
    }
    const inFlight = this.pendingNameQueries.get(guid);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      this.send(Opcode.CMSG_NAME_QUERY, new ByteWriter(8).u64(guid).data());
      // Several queries can be outstanding at once, so match the reply by GUID rather
      // than assuming replies arrive in request order.
      for (;;) {
        const packet = await this.waitFor(Opcode.SMSG_NAME_QUERY_RESPONSE);
        const reader = new ByteReader(packet.payload);
        const replyGuid = reader.packedGuid();
        const unknown = reader.u8();
        if (unknown !== 0) {
          if (replyGuid === guid) {
            return '';
          }
          continue;
        }
        const name = reader.cstring();
        this.nameCache.set(replyGuid, name);
        if (replyGuid === guid) {
          return name;
        }
      }
    })();

    this.pendingNameQueries.set(guid, request);
    try {
      return await request;
    } finally {
      this.pendingNameQueries.delete(guid);
    }
  }

  cachedName(guid: bigint): string | undefined {
    return this.nameCache.get(guid);
  }

  /**
   * Seeds the name cache. Worth doing for our own character, whose name we already know
   * from the character list - otherwise our first self-addressed chat line renders as a
   * bare GUID while the name query is still in flight.
   */
  rememberName(guid: bigint, name: string): void {
    this.nameCache.set(guid, name);
  }

  // --------------------------------------------------------------- session

  async logout(): Promise<void> {
    this.send(Opcode.CMSG_LOGOUT_REQUEST);
    try {
      await this.waitFor(Opcode.SMSG_LOGOUT_COMPLETE, 25_000);
    } catch {
      // Logout is delayed by 20s in combat or away from a rest area. Closing the socket
      // saves the character anyway, so a timeout here is not fatal.
    }
  }

  close(): void {
    this.stopKeepalive();
    this.closed = true;
    this.transport.close();
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.pingTimer = setInterval(() => {
      this.send(
        Opcode.CMSG_PING,
        new ByteWriter(8).u32(++this.pingSequence).u32(0).data(),
      );
    }, PING_INTERVAL_MS);
    // Do not hold the Node event loop open just for pings.
    (this.pingTimer as { unref?: () => void }).unref?.();
  }

  private stopKeepalive(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // -------------------------------------------------------------- dispatch

  private dispatch(packet: WorldPacket): void {
    this.onPacketLog?.('recv', packet.opcode, packet.payload);
    this.emit('packet', packet);

    const waiting = this.waiters.get(packet.opcode);
    if (waiting && waiting.length > 0) {
      waiting.shift()!(packet);
      return;
    }

    switch (packet.opcode) {
      case Opcode.SMSG_MESSAGECHAT:
        this.handleChat(packet.payload);
        return;

      case Opcode.SMSG_TIME_SYNC_REQ: {
        // Unanswered time sync requests eventually get the session dropped.
        const counter = new ByteReader(packet.payload).u32();
        this.send(
          Opcode.CMSG_TIME_SYNC_RESP,
          new ByteWriter(8).u32(counter).u32(Date.now() & 0xffffffff).data(),
        );
        return;
      }

      case Opcode.SMSG_MOTD: {
        const reader = new ByteReader(packet.payload);
        const count = reader.u32();
        const lines: string[] = [];
        for (let i = 0; i < count && reader.remaining > 0; i++) {
          lines.push(reader.cstring());
        }
        this.emit('motd', lines);
        return;
      }

      case Opcode.SMSG_COMPRESSED_UPDATE_OBJECT: {
        // Inflated now, parsed in a later milestone.
        const reader = new ByteReader(packet.payload);
        reader.u32(); // uncompressed size
        if (this.options.inflate) {
          try {
            this.options.inflate(packet.payload.subarray(4));
          } catch (error) {
            this.emit('error', error as Error);
          }
        }
        this.count(packet.opcode);
        return;
      }

      case Opcode.SMSG_PONG:
      case Opcode.SMSG_ADDON_INFO:
      case Opcode.SMSG_CLIENTCACHE_VERSION:
      case Opcode.SMSG_TUTORIAL_FLAGS:
        return;

      default:
        this.count(packet.opcode);
        this.emit('unhandled', packet);
    }
  }

  private count(opcode: number): void {
    this.unhandledOpcodes.set(opcode, (this.unhandledOpcodes.get(opcode) ?? 0) + 1);
  }

  private handleChat(payload: Uint8Array): void {
    try {
      this.emit('chat', parseChatMessage(payload, this.nameCache));
    } catch (error) {
      // A chat type we do not parse yet must not take down the session.
      this.emit('error', new Error(`could not parse SMSG_MESSAGECHAT (${toHex(payload.subarray(0, 16))}): ${(error as Error).message}`));
    }
  }
}

// ------------------------------------------------------------------ parsers

/** Player::BuildEnumData */
export const parseCharEnum = (payload: Uint8Array): CharacterInfo[] => {
  const reader = new ByteReader(payload);
  const count = reader.u8();
  const characters: CharacterInfo[] = [];

  for (let i = 0; i < count; i++) {
    const character: CharacterInfo = {
      guid: reader.u64(),
      name: reader.cstring(),
      race: reader.u8(),
      class: reader.u8(),
      gender: reader.u8(),
      skin: reader.u8(),
      face: reader.u8(),
      hairStyle: reader.u8(),
      hairColor: reader.u8(),
      facialStyle: reader.u8(),
      level: reader.u8(),
      zone: reader.u32(),
      map: reader.u32(),
      x: reader.f32(),
      y: reader.f32(),
      z: reader.f32(),
      guildId: reader.u32(),
      flags: reader.u32(),
      customizeFlags: reader.u32(),
      firstLogin: reader.u8() !== 0,
      petDisplayId: reader.u32(),
      petLevel: reader.u32(),
      petFamily: reader.u32(),
      items: [],
    };

    const items: CharacterItem[] = [];
    for (let slot = 0; slot < CHAR_ENUM_ITEM_SLOTS; slot++) {
      items.push({
        displayId: reader.u32(),
        inventoryType: reader.u8(),
        enchantId: reader.u32(),
      });
    }
    character.items = items;

    characters.push(character);
  }

  return characters;
};

/** ChatHandler.cpp / Chat::BuildChatPacket */
export const parseChatMessage = (
  payload: Uint8Array,
  nameCache?: Map<bigint, string>,
): ChatMessage => {
  const reader = new ByteReader(payload);
  const type = reader.u8();
  const language = reader.u32();
  const senderGuid = reader.u64();
  reader.u32(); // always zero

  let senderName: string | undefined;
  let channel: string | undefined;

  if (CHAT_TYPES_WITH_SENDER_NAME.has(type)) {
    reader.u32(); // name length, including the terminator
    senderName = reader.cstring();
  } else if (type === ChatMessageType.CHANNEL) {
    channel = reader.cstring();
  }

  const targetGuid = reader.u64();
  const textLength = reader.u32();
  const text = textLength > 0 ? reader.fixedString(textLength) : '';
  const tag = reader.remaining > 0 ? reader.u8() : 0;

  return {
    type,
    typeName: chatMessageTypeName(type),
    language,
    senderGuid,
    senderName: senderName ?? nameCache?.get(senderGuid),
    channel,
    targetGuid,
    text,
    tag,
  };
};
