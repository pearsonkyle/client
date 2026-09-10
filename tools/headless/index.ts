// Headless client. Exercises the protocol library against a live AzerothCore instance
// without a browser, so every wire format is proven before any UI work depends on it.
//
//   npm run headless -- login --user WOWSER1 --pass TEST1234
//   npm run headless -- play  --user WOWSER1 --pass TEST1234 --say "hello"

import { AuthClient } from '../../src/net/auth/AuthClient';
import { toHex } from '../../src/net/bytes';
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
