import { fromHex, toHex } from '../bytes';
import { Rc4 } from './rc4';
import { calculateVerifier, sha1Interleave, srp6Proof, SRP6_G, SRP6_N } from './srp6';
import { hmacSha1, sha1 } from './sha1';

const utf8 = (value: string) => new TextEncoder().encode(value);

describe('sha1', () => {
  // FIPS 180-2 / RFC 3174 vectors
  it('hashes the empty string', () => {
    expect(toHex(sha1(new Uint8Array(0)))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  it('hashes "abc"', () => {
    expect(toHex(sha1(utf8('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('hashes a two-block message', () => {
    const input = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(toHex(sha1(utf8(input)))).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
  });

  it('pads correctly around the block boundary', () => {
    // 55 bytes still fits one block once the 0x80 and length are appended; 56 forces a
    // second block. Values cross-checked against Node's crypto.createHash('sha1').
    expect(toHex(sha1(utf8('a'.repeat(55))))).toBe('c1c8bbdc22796e28c0e15163d20899b65621d65a');
    expect(toHex(sha1(utf8('a'.repeat(56))))).toBe('c2db330f6083854c99d4b5bfb6e8f29f201be699');
    expect(toHex(sha1(utf8('a'.repeat(64))))).toBe('0098ba824b5c16427bd7a1122a5a442a25ec644d');
    expect(toHex(sha1(utf8('a'.repeat(119))))).toBe('ee971065aaa017e0632a8ca6c77bb3bf8b1dfc56');
    expect(toHex(sha1(utf8('a'.repeat(120))))).toBe('f34c1488385346a55709ba056ddd08280dd4c6d6');
  });

  it('hashes a million "a"s', () => {
    expect(toHex(sha1(utf8('a'.repeat(1000000))))).toBe('34aa973cd4c4daa4f61eeb2bdbad27316534016f');
  });

  it('treats concatenated inputs as one message', () => {
    expect(toHex(sha1(utf8('ab'), utf8('c')))).toBe(toHex(sha1(utf8('abc'))));
  });
});

describe('hmacSha1', () => {
  // RFC 2202
  it('matches the 20-byte-key vector', () => {
    const key = fromHex('0b'.repeat(20));
    expect(toHex(hmacSha1(key, utf8('Hi There')))).toBe('b617318655057264e28bc0b6fb378c8ef146be00');
  });

  it('matches the "Jefe" vector', () => {
    expect(toHex(hmacSha1(utf8('Jefe'), utf8('what do ya want for nothing?')))).toBe(
      'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
    );
  });

  it('matches the oversized-key vector', () => {
    const key = fromHex('aa'.repeat(80));
    const data = utf8('Test Using Larger Than Block-Size Key - Hash Key First');
    expect(toHex(hmacSha1(key, data))).toBe('aa4ae5e15272d00e95705637ce8a3b55ed402112');
  });
});

describe('Rc4', () => {
  // RFC 6229 test vectors
  it('produces the expected keystream for a 40-bit key', () => {
    const rc4 = new Rc4(fromHex('0102030405'));
    expect(toHex(rc4.process(new Uint8Array(16)))).toBe('b2396305f03dc027ccc3524a0a1118a8');
  });

  it('produces the expected keystream for a 128-bit key', () => {
    const rc4 = new Rc4(fromHex('0102030405060708090a0b0c0d0e0f10'));
    expect(toHex(rc4.process(new Uint8Array(16)))).toBe('9ac7cc9a609d1ef7b2932899cde41b97');
  });

  it('round-trips through a second cipher with the same key', () => {
    const plaintext = utf8('the quick brown fox');
    const encrypted = new Rc4(fromHex('deadbeef')).process(plaintext.slice());
    expect(toHex(encrypted)).not.toBe(toHex(plaintext));
    const decrypted = new Rc4(fromHex('deadbeef')).process(encrypted);
    expect(toHex(decrypted)).toBe(toHex(plaintext));
  });

  it('keeps keystream position across calls', () => {
    const streaming = new Rc4(fromHex('0102030405'));
    const first = streaming.process(new Uint8Array(8));
    const second = streaming.process(new Uint8Array(8));
    expect(toHex(first) + toHex(second)).toBe('b2396305f03dc027ccc3524a0a1118a8');
  });

  it('advances the keystream when dropping bytes', () => {
    const dropped = new Rc4(fromHex('0102030405'));
    dropped.drop(8);
    expect(toHex(dropped.process(new Uint8Array(8)))).toBe('ccc3524a0a1118a8');
  });
});

describe('sha1Interleave', () => {
  it('skips leading zero bytes of S', () => {
    // A leading zero byte must change the result: this is exactly the case the old
    // wowser got wrong, and it happens for roughly 1 in 256 logins.
    const withZero = new Uint8Array(32);
    withZero.set(fromHex('11'.repeat(31)), 1);

    const shifted = new Uint8Array(32);
    shifted.set(fromHex('11'.repeat(31)), 0);

    expect(toHex(sha1Interleave(withZero))).not.toBe(toHex(sha1Interleave(shifted)));
  });

  it('produces a 40-byte key', () => {
    expect(sha1Interleave(fromHex('a1'.repeat(32))).length).toBe(40);
  });

  it('rounds an odd zero-prefix up to an even offset', () => {
    // p = 1 (odd) must round to 2, so these two share a hash offset and differ only in
    // the bytes that are actually hashed.
    const one = new Uint8Array(32);
    one.set(fromHex('22'.repeat(31)), 1);
    expect(sha1Interleave(one).length).toBe(40);
  });
});

describe('SRP6 against the live AzerothCore account', () => {
  // Captured from acore_auth.account for WOWSER1 / TEST1234, created by the worldserver
  // console. If the account is ever recreated the server picks a new random salt and
  // these two constants must be recaptured together.
  const SALT = fromHex('EF182353DA286880DD806300C340D50004E95D670D21A330C2FDAB489AF8AD60');
  const VERIFIER = fromHex('19E8FAAB71BB38F38F877E68A4D977BC23E1DEA7AF05DDC614FD45FD4C024B2A');
  const N = SRP6_N;
  const G = SRP6_G;

  it('exposes N as the little-endian form of the documented modulus', () => {
    // The wire order is the reverse of how the constant is written in the spec.
    expect(toHex(N)).toBe('b79b3e2a87823cab8f5ebfbf8eb10108535006298b5badbd5b53e1895e644b89');
  });

  it('recomputes the verifier the server stored', () => {
    expect(toHex(calculateVerifier('WOWSER1', 'TEST1234', SALT, N, G))).toBe(toHex(VERIFIER));
  });

  it('uppercases the account and password before hashing', () => {
    expect(toHex(calculateVerifier('wowser1', 'test1234', SALT, N, G))).toBe(toHex(VERIFIER));
  });

  it('rejects a wrong password', () => {
    expect(toHex(calculateVerifier('WOWSER1', 'WRONGPASS', SALT, N, G))).not.toBe(toHex(VERIFIER));
  });

  it('completes the exchange against a server simulated from the verifier', () => {
    // Play the server's half locally: pick b, derive B = (g^b + 3v) mod N, then check
    // that the client's M1 matches what the server would compute, and that both sides
    // land on the same session key.
    const modPow = (base: bigint, exp: bigint, mod: bigint): bigint => {
      let result = 1n;
      let b = base % mod;
      let e = exp;
      while (e > 0n) {
        if ((e & 1n) === 1n) result = (result * b) % mod;
        e >>= 1n;
        b = (b * b) % mod;
      }
      return result;
    };
    const fromLE = (bytes: Uint8Array): bigint => {
      let value = 0n;
      for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]!);
      return value;
    };
    const toLE = (value: bigint, size: number): Uint8Array => {
      const bytes = new Uint8Array(size);
      let rest = value;
      for (let i = 0; i < size; i++) {
        bytes[i] = Number(rest & 0xffn);
        rest >>= 8n;
      }
      return bytes;
    };

    const nInt = fromLE(N);
    const vInt = fromLE(VERIFIER);
    const bPrivate = fromLE(fromHex('5c'.repeat(19)));
    const B = toLE((modPow(7n, bPrivate, nInt) + vInt * 3n) % nInt, 32);

    const client = srp6Proof('WOWSER1', 'TEST1234', SALT, B, N, G, fromHex('a3'.repeat(19)));

    // Server side: S = (A * v^u)^b mod N
    const u = fromLE(sha1(client.A, B));
    const serverS = toLE(modPow((fromLE(client.A) * modPow(vInt, u, nInt)) % nInt, bPrivate, nInt), 32);
    const serverKey = sha1Interleave(serverS);

    expect(toHex(client.sessionKey)).toBe(toHex(serverKey));

    const nHash = sha1(N);
    const gHash = sha1(G);
    const ngHash = new Uint8Array(20);
    for (let i = 0; i < 20; i++) ngHash[i] = nHash[i]! ^ gHash[i]!;
    const serverM1 = sha1(ngHash, sha1(utf8('WOWSER1')), SALT, client.A, B, serverKey);

    expect(toHex(client.M1)).toBe(toHex(serverM1));
    expect(toHex(client.M2)).toBe(toHex(sha1(client.A, serverM1, serverKey)));
  });

  it('produces a different A on each run', () => {
    const first = srp6Proof('WOWSER1', 'TEST1234', SALT, fromHex('bb'.repeat(32)), N, G);
    const second = srp6Proof('WOWSER1', 'TEST1234', SALT, fromHex('bb'.repeat(32)), N, G);
    expect(toHex(first.A)).not.toBe(toHex(second.A));
  });
});
