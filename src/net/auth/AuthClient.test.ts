import { fromHex } from '../bytes';
import { authFrameSize, AuthClient } from './AuthClient';
import { AuthOpcode, AuthResult } from './opcodes';
import { Transport } from '../transport/Transport';

// A realm list captured from a live AzerothCore instance on 2026-09-10.
const REALM_LIST = fromHex(
  '102d00000000000100000000417a65726f7468436f726500' +
    '3132372e302e302e313a3830383500000000000001011000',
);

describe('authFrameSize', () => {
  it('sizes a rejected challenge as three bytes', () => {
    expect(authFrameSize(fromHex('000004'))).toBe(3);
  });

  it('waits for the status byte of a challenge', () => {
    expect(authFrameSize(fromHex('0000'))).toBeNull();
  });

  it('sizes a successful challenge from its embedded lengths', () => {
    // cmd, unk, status, B[32], gLen=1, g, NLen=32, N[32], s[32], unk[16], flags
    const frame = fromHex(
      '000000' + 'bb'.repeat(32) + '01' + '07' + '20' + 'cc'.repeat(32) + 'dd'.repeat(32) + 'ee'.repeat(16) + '00',
    );
    expect(authFrameSize(frame)).toBe(frame.length);
    expect(frame.length).toBe(119);
  });

  it('waits when a successful challenge is truncated before its length fields', () => {
    expect(authFrameSize(fromHex('000000' + 'bb'.repeat(20)))).toBeNull();
  });

  it('sizes a successful proof as 32 bytes', () => {
    expect(authFrameSize(fromHex('0100' + '00'.repeat(30)))).toBe(32);
  });

  it('sizes a failed proof as four bytes', () => {
    expect(authFrameSize(fromHex('01040000'))).toBe(4);
  });

  it('sizes a version rejection as two bytes, which carries no login flags', () => {
    expect(authFrameSize(fromHex('0109'))).toBe(2);
  });

  it('sizes a realm list from its length prefix', () => {
    expect(authFrameSize(REALM_LIST)).toBe(REALM_LIST.length);
  });

  it('rejects an opcode it does not know', () => {
    expect(() => authFrameSize(fromHex('99'))).toThrow(/unknown auth opcode/);
  });
});

// A transport that hands back scripted replies, so the client can be driven without a
// socket.
class FakeTransport implements Transport {
  sent: Uint8Array[] = [];
  connected = true;
  private dataHandler: ((bytes: Uint8Array) => void) | null = null;
  private closeHandler: ((error?: Error) => void) | null = null;
  replies: Uint8Array[] = [];

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(bytes: Uint8Array): void {
    this.sent.push(bytes.slice());
    const reply = this.replies.shift();
    if (reply) {
      // Deliver asynchronously, the way a real socket would.
      queueMicrotask(() => this.dataHandler?.(reply));
    }
  }

  onData(handler: (bytes: Uint8Array) => void): void {
    this.dataHandler = handler;
  }

  onClose(handler: (error?: Error) => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.connected = false;
    this.closeHandler?.();
  }

  deliver(bytes: Uint8Array): void {
    this.dataHandler?.(bytes);
  }
}

describe('AuthClient', () => {
  it('builds a logon challenge the server can parse', async () => {
    const transport = new FakeTransport();
    const client = new AuthClient(transport);
    // Reply with a rejection so login() settles instead of hanging.
    transport.replies.push(fromHex('000004'));

    await expect(client.login('wowser1', 'test1234')).rejects.toThrow(/FAIL_UNKNOWN_ACCOUNT/);

    const challenge = transport.sent[0]!;
    expect(challenge[0]).toBe(AuthOpcode.LOGON_CHALLENGE);
    // size field = 30 + account length
    expect(challenge[2]! | (challenge[3]! << 8)).toBe(30 + 'WOWSER1'.length);
    // gamename, platform, os and country are written back-to-front
    expect(Array.from(challenge.subarray(4, 8))).toEqual([0x00, 0x57, 0x6f, 0x57]);
    expect(challenge[8]).toBe(3);
    expect(challenge[9]).toBe(3);
    expect(challenge[10]).toBe(5);
    expect(challenge[11]! | (challenge[12]! << 8)).toBe(12340);
    expect(Array.from(challenge.subarray(13, 17))).toEqual([0x00, 0x36, 0x38, 0x78]); // x86
    expect(Array.from(challenge.subarray(17, 21))).toEqual([0x00, 0x6e, 0x69, 0x57]); // Win
    expect(Array.from(challenge.subarray(21, 25))).toEqual([0x53, 0x55, 0x6e, 0x65]); // enUS
    // account is uppercased on the wire
    expect(new TextDecoder().decode(challenge.subarray(34))).toBe('WOWSER1');
  });

  it('uppercases the account it will send to the world server', async () => {
    const transport = new FakeTransport();
    const client = new AuthClient(transport);
    transport.replies.push(fromHex('000004'));
    await expect(client.login('wowser1', 'test1234')).rejects.toThrow();
    expect(client.account).toBe('WOWSER1');
  });

  it('refuses accounts that need a PIN or token', async () => {
    const transport = new FakeTransport();
    const client = new AuthClient(transport);
    // securityFlags = 0x01 (PIN) in the final byte
    transport.replies.push(
      fromHex('000000' + 'bb'.repeat(32) + '0107' + '20' + 'cc'.repeat(32) + 'dd'.repeat(32) + 'ee'.repeat(16) + '01'),
    );
    await expect(client.login('WOWSER1', 'TEST1234')).rejects.toThrow(/additional authentication/);
  });

  it('reports the rejection code from a failed challenge', async () => {
    const transport = new FakeTransport();
    const client = new AuthClient(transport);
    transport.replies.push(new Uint8Array([AuthOpcode.LOGON_CHALLENGE, 0, AuthResult.FAIL_BANNED]));
    await expect(client.login('WOWSER1', 'TEST1234')).rejects.toThrow(/FAIL_BANNED/);
  });

  it('refuses to request the realm list before logging in', async () => {
    const client = new AuthClient(new FakeTransport());
    await expect(client.realmList()).rejects.toThrow(/requires a completed login/);
  });

  it('parses a realm list captured from the live server', async () => {
    const transport = new FakeTransport();
    const client = new AuthClient(transport);
    client.sessionKey = new Uint8Array(40); // stand in for a completed login
    transport.replies.push(REALM_LIST);

    const realms = await client.realmList();

    expect(realms).toHaveLength(1);
    const realm = realms[0]!;
    expect(realm.name).toBe('AzerothCore');
    expect(realm.address).toBe('127.0.0.1:8085');
    expect(realm.host).toBe('127.0.0.1');
    expect(realm.port).toBe(8085);
    expect(realm.id).toBe(1);
    expect(realm.characterCount).toBe(0);
    expect(realm.online).toBe(true);
  });

  it('reassembles a realm list split across two reads', async () => {
    const transport = new FakeTransport();
    const client = new AuthClient(transport);
    client.sessionKey = new Uint8Array(40);

    const pending = client.realmList();
    // Split mid-string, where a naive parser would trip.
    transport.deliver(REALM_LIST.subarray(0, 13));
    transport.deliver(REALM_LIST.subarray(13));

    const realms = await pending;
    expect(realms[0]!.name).toBe('AzerothCore');
  });

  it('rejects in-flight requests when the connection drops', async () => {
    const transport = new FakeTransport();
    const client = new AuthClient(transport);
    client.sessionKey = new Uint8Array(40);

    const pending = client.realmList();
    transport.close();

    await expect(pending).rejects.toThrow(/closed/);
  });
});
