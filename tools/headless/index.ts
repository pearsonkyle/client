// Headless client. Exercises the protocol library against a live AzerothCore instance
// without a browser, so every wire format is proven before any UI work depends on it.
//
//   npm run headless -- login --user WOWSER1 --pass TEST1234
//   npm run headless -- play  --user WOWSER1 --pass TEST1234 --say "hello"

import zlib from 'node:zlib';

import { AuthClient } from '../../src/net/auth/AuthClient';
import { toHex } from '../../src/net/bytes';
import { opcodeName } from '../../src/net/world/opcodes';
import { CharacterClass, Race } from '../../src/net/world/types';
import { WorldClient } from '../../src/net/world/WorldClient';
import { TcpTransport } from '../net/TcpTransport';

type Args = {
  command: string;
  host: string;
  authPort: number;
  user: string;
  pass: string;
  realm?: string;
  char?: string;
  say?: string;
  race?: number;
  class?: number;
  linger: number;
  verbose: boolean;
};

const parseArgs = (argv: string[]): Args => {
  const [command = 'login', ...rest] = argv;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (!token.startsWith('--')) {
      continue;
    }
    const name = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(name, 'true');
    } else {
      flags.set(name, next);
      i++;
    }
  }

  const number = (name: string, fallback: number): number => {
    const raw = flags.get(name);
    return raw === undefined ? fallback : Number(raw);
  };

  return {
    command,
    host: flags.get('host') ?? '127.0.0.1',
    authPort: number('auth-port', 3724),
    user: flags.get('user') ?? 'WOWSER1',
    pass: flags.get('pass') ?? 'TEST1234',
    realm: flags.get('realm'),
    char: flags.get('char'),
    say: flags.get('say'),
    race: flags.has('race') ? number('race', 1) : undefined,
    class: flags.has('class') ? number('class', 1) : undefined,
    linger: number('linger', 0),
    verbose: flags.get('verbose') === 'true',
  };
};

const log = (...parts: unknown[]) => console.log(...parts);

export const runAuth = async (args: Args, transport: TcpTransport) => {
  const auth = new AuthClient(transport);

  if (args.verbose) {
    auth.onPacket = (direction, opcode, bytes) => {
      const arrow = direction === 'send' ? '-->' : '<--';
      const hex = bytes.length <= 256 ? toHex(bytes) : `${toHex(bytes.subarray(0, 256))}...`;
      log(`  ${arrow} auth 0x${opcode.toString(16).padStart(2, '0')} (${bytes.length}B) ${hex}`);
    };
  }

  log(`connecting to authserver ${args.host}:${args.authPort}`);
  await transport.connect(args.host, args.authPort);

  const sessionKey = await auth.login(args.user, args.pass);
  log('LOGON_CHALLENGE ok');
  log(`LOGON_PROOF ok (M2 verified), session key ${toHex(sessionKey.subarray(0, 8))}... (${sessionKey.length}B)`);

  const realms = await auth.realmList();
  log(`REALM_LIST ok (${realms.length} realm${realms.length === 1 ? '' : 's'})`);
  for (const realm of realms) {
    log(
      `  ${realm.name} ${realm.host}:${realm.port} id=${realm.id} chars=${realm.characterCount} ` +
        `pop=${realm.population.toFixed(1)} ${realm.online ? 'online' : 'OFFLINE'}${realm.build ? ` build=${realm.build}` : ''}`,
    );
  }

  return { auth, realms };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runPlay = async (args: Args, open: { close(): void }[]) => {
  const authTransport = new TcpTransport();
  open.push(authTransport);
  const { auth, realms } = await runAuth(args, authTransport);

  const realm = args.realm
    ? realms.find((candidate) => candidate.name.toLowerCase() === args.realm!.toLowerCase())
    : realms[0];
  if (!realm) {
    throw new Error(
      `realm '${args.realm}' not found (have: ${realms.map((r) => r.name).join(', ')})`,
    );
  }
  if (!auth.sessionKey) {
    throw new Error('no session key after login');
  }

  // The auth socket has done its job; the world server is a separate connection.
  authTransport.close();

  log(`\nconnecting to worldserver ${realm.host}:${realm.port} (realm ${realm.name}, id ${realm.id})`);
  const worldTransport = new TcpTransport();
  open.push(worldTransport);
  await worldTransport.connect(realm.host, realm.port);

  const world = new WorldClient(worldTransport, {
    inflate: (data) => new Uint8Array(zlib.inflateSync(Buffer.from(data))),
  });

  if (args.verbose) {
    world.onPacketLog = (direction, opcode, bytes) => {
      const arrow = direction === 'send' ? '-->' : '<--';
      log(`  ${arrow} ${opcodeName(opcode).padEnd(34)} ${bytes.length}B`);
    };
  }

  world.on('error', (error) => log(`  ! ${error.message}`));
  world.on('queued', (position) => log(`  queued at position ${position}`));
  world.on('motd', (lines) => lines.filter(Boolean).forEach((line) => log(`  MOTD: ${line}`)));

  const response = await world.authenticate(auth.account, auth.sessionKey, realm.id);
  log(`AUTH_OK expansion=${response.expansion}`);

  let characters = await world.characters();
  log(`SMSG_CHAR_ENUM: ${characters.length} character(s)`);
  for (const character of characters) {
    log(
      `  ${character.name} level ${character.level} ${Race[character.race] ?? character.race}/` +
        `${CharacterClass[character.class] ?? character.class} map=${character.map} zone=${character.zone}`,
    );
  }

  const wanted = args.char;
  let character = wanted
    ? characters.find((candidate) => candidate.name.toLowerCase() === wanted.toLowerCase())
    : characters[0];

  if (!character) {
    const name = wanted ?? 'Wowsertest';
    const race = args.race ?? Race.HUMAN;
    const characterClass = args.class ?? CharacterClass.WARRIOR;
    log(`\ncreating character ${name} (race ${race}, class ${characterClass})`);
    await world.createCharacter({ name, race, class: characterClass });

    characters = await world.characters();
    character = characters.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!character) {
      throw new Error(`created ${name} but it did not appear in the character list`);
    }
    log(`  created ${character.name} (guid ${character.guid})`);
  }

  world.rememberName(character.guid, character.name);

  log(`\nentering world as ${character.name}`);
  const position = await world.enterWorld(character.guid);
  log(
    `LOGIN_VERIFY_WORLD map=${position.map} x=${position.x.toFixed(2)} ` +
      `y=${position.y.toFixed(2)} z=${position.z.toFixed(2)} o=${position.orientation.toFixed(2)}`,
  );

  world.on('chat', (message) => {
    const sender = message.senderName ?? `guid:${message.senderGuid}`;
    log(`  [${message.typeName}] ${sender}: ${message.text}`);
    if (!message.senderName && message.senderGuid !== 0n) {
      // Resolve the name for next time; SMSG_MESSAGECHAT only carries a GUID.
      void world.nameQuery(message.senderGuid).catch(() => undefined);
    }
  });

  if (args.say !== undefined) {
    // Give the server a moment to finish the post-login packet burst.
    await sleep(1000);
    log(`\nsaying: ${args.say}`);
    world.say(args.say, character.race);
  }

  if (args.linger > 0) {
    log(`\nholding the session open for ${args.linger}s (keepalive pings every 30s)`);
    await sleep(args.linger * 1000);
  } else {
    await sleep(2000);
  }

  if (world.unhandledOpcodes.size > 0) {
    const sorted = [...world.unhandledOpcodes.entries()].sort((a, b) => b[1] - a[1]);
    log(`\nunhandled opcodes (${sorted.length} kinds) - the backlog for later milestones:`);
    for (const [opcode, count] of sorted.slice(0, 20)) {
      log(`  ${opcodeName(opcode).padEnd(36)} x${count}`);
    }
    if (sorted.length > 20) {
      log(`  ... and ${sorted.length - 20} more`);
    }
  }

  log('\nlogging out');
  await world.logout();
  log('SMSG_LOGOUT_COMPLETE');
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  // An open socket keeps the Node event loop alive, so every exit path - including the
  // failure paths - has to close what it opened.
  const open: { close(): void }[] = [];

  try {
    if (args.command === 'login') {
      const transport = new TcpTransport();
      open.push(transport);
      await runAuth(args, transport);
      return;
    }

    if (args.command === 'play') {
      await runPlay(args, open);
      return;
    }

    throw new Error(`unknown command '${args.command}' (expected: login, play)`);
  } finally {
    for (const closeable of open) {
      closeable.close();
    }
  }
};

main().catch((error: Error) => {
  console.error(`\n${error.name === 'Error' ? 'error' : error.name}: ${error.message}`);
  process.exitCode = 1;
});
