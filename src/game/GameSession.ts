// Browser-side session: owns the auth and world connections and the state the Lua glue
// screens ask about.
//
// The protocol work is all in src/net; this is the layer that sequences it and exposes
// it in the shape FrameXML expects (a current screen, a realm list, a character list).

import { AuthClient, Realm } from '../net/auth/AuthClient';
import { TypedEmitter } from '../net/TypedEmitter';
import { WebSocketTransport } from '../net/transport/WebSocketTransport';
import { WorldClient } from '../net/world/WorldClient';
import { CharacterInfo, ChatMessage, WorldPosition } from '../net/world/types';
import { authHost, authPort, build, bridgeUrl } from '../config';

export type SessionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'realmlist'
  | 'charlist'
  | 'entering'
  | 'inworld';

export type SessionEvents = {
  state: [SessionState];
  /** Progress text for the login status dialog. */
  status: [string];
  error: [string];
  realms: [Realm[]];
  characters: [CharacterInfo[]];
  enteredWorld: [WorldPosition, CharacterInfo];
  chat: [ChatMessage];
  motd: [string[]];
};

const inflateInBrowser = async (data: Uint8Array): Promise<Uint8Array> => {
  const stream = new DecompressionStream('deflate');
  const decompressed = new Response(
    new Blob([data as unknown as BlobPart]).stream().pipeThrough(stream),
  );
  return new Uint8Array(await decompressed.arrayBuffer());
};

export class GameSession extends TypedEmitter<SessionEvents> {
  state: SessionState = 'disconnected';
  account = '';
  realms: Realm[] = [];
  realm: Realm | null = null;
  characters: CharacterInfo[] = [];
  selectedIndex = 0;
  position: WorldPosition | null = null;
  readonly chatLog: ChatMessage[] = [];

  private auth: AuthClient | null = null;
  private authTransport: WebSocketTransport | null = null;
  private world: WorldClient | null = null;
  private worldTransport: WebSocketTransport | null = null;
  private sessionKey: Uint8Array | null = null;

  private setState(state: SessionState): void {
    this.state = state;
    this.emit('state', state);
  }

  get selectedCharacter(): CharacterInfo | null {
    return this.characters[this.selectedIndex] ?? null;
  }

  get isConnected(): boolean {
    return this.state !== 'disconnected' && this.state !== 'connecting';
  }

  /**
   * Logs in and fetches the realm list. Mirrors what DefaultServerLogin does in the real
   * client.
   */
  async login(account: string, password: string): Promise<void> {
    if (this.state !== 'disconnected') {
      this.disconnect();
    }

    this.account = account.toUpperCase();
    this.setState('connecting');
    this.emit('status', 'Connecting...');

    try {
      const transport = new WebSocketTransport({ bridgeUrl });
      this.authTransport = transport;
      await transport.connect(authHost, authPort);

      const auth = new AuthClient(transport, build);
      this.auth = auth;

      this.setState('authenticating');
      this.emit('status', 'Authenticating...');
      this.sessionKey = await auth.login(account, password);

      this.emit('status', 'Retrieving realm list...');
      this.realms = await auth.realmList();
      this.emit('realms', this.realms);
      this.setState('realmlist');
    } catch (error) {
      this.disconnect();
      const message = (error as Error).message;
      this.emit('error', message);
      throw error;
    }
  }

  /** Connects to a realm and fetches its character list. */
  async selectRealm(realm: Realm): Promise<CharacterInfo[]> {
    if (!this.sessionKey || !this.auth) {
      throw new Error('not logged in');
    }

    this.realm = realm;
    this.emit('status', `Connecting to ${realm.name}...`);

    // The auth socket has done its job.
    this.authTransport?.close();
    this.authTransport = null;

    const transport = new WebSocketTransport({ bridgeUrl });
    this.worldTransport = transport;
    await transport.connect(realm.host, realm.port);

    const world = new WorldClient(transport, {
      build: build.build,
      // Browser zlib is async, so hand the world client a synchronous no-op and inflate
      // out of band. Nothing parses these payloads yet.
      inflate: (data) => {
        void inflateInBrowser(data).catch(() => undefined);
        return new Uint8Array(0);
      },
    });
    this.world = world;

    world.on('chat', (message) => {
      this.chatLog.push(message);
      this.emit('chat', message);
      if (!message.senderName && message.senderGuid !== 0n) {
        void world.nameQuery(message.senderGuid).catch(() => undefined);
      }
    });
    world.on('motd', (lines) => this.emit('motd', lines));
    world.on('error', (error) => this.emit('error', error.message));
    world.on('disconnected', () => {
      if (this.state !== 'disconnected') {
        this.emit('error', 'Disconnected from the world server.');
        this.disconnect();
      }
    });

    await world.authenticate(this.account, this.sessionKey, realm.id);

    this.emit('status', 'Retrieving character list...');
    this.characters = await world.characters();
    this.selectedIndex = 0;
    this.emit('characters', this.characters);
    this.setState('charlist');
    return this.characters;
  }

  async refreshCharacters(): Promise<CharacterInfo[]> {
    if (!this.world) {
      throw new Error('not connected to a realm');
    }
    this.characters = await this.world.characters();
    this.emit('characters', this.characters);
    return this.characters;
  }

  async createCharacter(options: {
    name: string;
    race: number;
    class: number;
    gender?: number;
  }): Promise<void> {
    if (!this.world) {
      throw new Error('not connected to a realm');
    }
    await this.world.createCharacter(options);
    await this.refreshCharacters();
  }

  selectCharacter(index: number): void {
    if (index >= 0 && index < this.characters.length) {
      this.selectedIndex = index;
    }
  }

  async enterWorld(): Promise<WorldPosition> {
    const character = this.selectedCharacter;
    if (!this.world || !character) {
      throw new Error('no character selected');
    }

    this.setState('entering');
    this.emit('status', `Entering world as ${character.name}...`);

    this.world.rememberName(character.guid, character.name);
    const position = await this.world.enterWorld(character.guid);
    this.position = position;
    this.setState('inworld');
    this.emit('enteredWorld', position, character);
    return position;
  }

  say(text: string): void {
    const character = this.selectedCharacter;
    if (!this.world || !character || this.state !== 'inworld') {
      return;
    }
    this.world.say(text, character.race);
  }

  disconnect(): void {
    this.world?.close();
    this.worldTransport?.close();
    this.authTransport?.close();
    this.world = null;
    this.worldTransport = null;
    this.authTransport = null;
    this.auth = null;
    this.sessionKey = null;
    this.characters = [];
    this.realms = [];
    this.realm = null;
    this.position = null;
    this.setState('disconnected');
  }
}

/** The client is a singleton in this codebase, and so is its session. */
export const session = new GameSession();
