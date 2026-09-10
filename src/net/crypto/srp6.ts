// SRP6 as WoW implements it (not stock RFC 2945).
//
// Cross-checked field by field against AzerothCore's
// src/common/Cryptography/Authentication/SRP6.cpp. Every big number on the wire is a
// little-endian byte array, and BigNumber::ToByteArray defaults to little-endian, so
// "LE 32 bytes" is the canonical form for A, B, N, s and S.

import { bigIntFromLE, bigIntToLE, modPow, randomBytes } from './bigint';
import { sha1, SHA1_DIGEST_LENGTH } from './sha1';

const KEY_LENGTH = 32;
const SESSION_KEY_LENGTH = 40;

// The derived key multiplier. WoW pins k = 3 rather than the RFC's H(N, g).
const K_MULTIPLIER = 3n;

const encoder = new TextEncoder();

/**
 * The modulus and generator, as little-endian byte arrays.
 *
 * The number itself is 0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7;
 * AzerothCore builds its copy with HexStrToByteArray<32>(..., true), i.e. reversed, and
 * that reversed array is what travels on the wire. The server sends N and g in every
 * challenge, so protocol code should use the received values - these exist for tests and
 * for computing a verifier offline.
 */
export const SRP6_N = new Uint8Array([
  0xb7, 0x9b, 0x3e, 0x2a, 0x87, 0x82, 0x3c, 0xab, 0x8f, 0x5e, 0xbf, 0xbf, 0x8e, 0xb1, 0x01, 0x08,
  0x53, 0x50, 0x06, 0x29, 0x8b, 0x5b, 0xad, 0xbd, 0x5b, 0x53, 0xe1, 0x89, 0x5e, 0x64, 0x4b, 0x89,
]);

export const SRP6_G = new Uint8Array([7]);

/**
 * Interleaves SHA-1 of the even and odd bytes of S into the 40-byte session key.
 *
 * The subtlety - and the reason the 2015 wowser failed a fraction of logins - is that
 * leading zero bytes of S are skipped before hashing. S is a uniformly random 256-bit
 * number, so it has a leading zero byte about 1 in 256 times; when it does, omitting
 * this produces a session key the server does not agree with, and the login fails with
 * no useful diagnostic. See SRP6::SHA1Interleave.
 */
export const sha1Interleave = (S: Uint8Array): Uint8Array => {
  const half = KEY_LENGTH / 2;
  const even = new Uint8Array(half);
  const odd = new Uint8Array(half);
  for (let i = 0; i < half; i++) {
    even[i] = S[i * 2]!;
    odd[i] = S[i * 2 + 1]!;
  }

  let p = 0;
  while (p < KEY_LENGTH && S[p] === 0) {
    p++;
  }
  if ((p & 1) !== 0) {
    p++;
  }
  p /= 2;

  const evenHash = sha1(even.subarray(p));
  const oddHash = sha1(odd.subarray(p));

  const K = new Uint8Array(SESSION_KEY_LENGTH);
  for (let i = 0; i < SHA1_DIGEST_LENGTH; i++) {
    K[i * 2] = evenHash[i]!;
    K[i * 2 + 1] = oddHash[i]!;
  }
  return K;
};

/**
 * x = H(s || H(UPPER(I) || ":" || UPPER(P))), as a little-endian integer.
 *
 * The server uppercases account and password before hashing, so we do it here rather
 * than trusting every call site to remember.
 */
export const calculateX = (account: string, password: string, salt: Uint8Array): bigint => {
  const credentials = sha1(encoder.encode(`${account.toUpperCase()}:${password.toUpperCase()}`));
  return bigIntFromLE(sha1(salt, credentials));
};

/**
 * v = g^x mod N - what the server stores in acore_auth.account.verifier.
 *
 * Exposed mainly so tests can recompute a verifier from a known password and the salt
 * the server generated, and compare against the database. That check exercises the
 * whole hashing path without needing a live socket.
 */
export const calculateVerifier = (
  account: string,
  password: string,
  salt: Uint8Array,
  N: Uint8Array = SRP6_N,
  g: Uint8Array = SRP6_G,
): Uint8Array => {
  const x = calculateX(account, password, salt);
  return bigIntToLE(modPow(bigIntFromLE(g), x, bigIntFromLE(N)), KEY_LENGTH);
};

export type Srp6Proof = {
  /** Client public ephemeral, 32 bytes LE - goes on the wire. */
  A: Uint8Array;
  /** Client proof, 20 bytes - goes on the wire. */
  M1: Uint8Array;
  /** Expected server proof, to compare against the M2 the server returns. */
  M2: Uint8Array;
  /** 40-byte session key, used for the world header crypt and the auth digest. */
  sessionKey: Uint8Array;
};

/**
 * Runs the client side of the exchange against the challenge the server sent.
 *
 * `account` and `password` are uppercased here, so callers may pass whatever the user
 * typed.
 */
export const srp6Proof = (
  account: string,
  password: string,
  salt: Uint8Array,
  B: Uint8Array,
  N: Uint8Array = SRP6_N,
  g: Uint8Array = SRP6_G,
  privateEphemeral?: Uint8Array,
): Srp6Proof => {
  const upperAccount = account.toUpperCase();
  const upperPassword = password.toUpperCase();

  const nInt = bigIntFromLE(N);
  const gInt = bigIntFromLE(g);
  const bInt = bigIntFromLE(B);

  let aInt: bigint;
  let aPublic: bigint;
  let attempts = 0;
  do {
    if (attempts++ > 16) {
      throw new Error('SRP6: could not generate a valid ephemeral key');
    }
    aInt = bigIntFromLE(privateEphemeral ?? randomBytes(19));
    aPublic = modPow(gInt, aInt, nInt);
  } while (aPublic % nInt === 0n && privateEphemeral === undefined);

  const A = bigIntToLE(aPublic, KEY_LENGTH);

  const x = calculateX(upperAccount, upperPassword, salt);
  const u = bigIntFromLE(sha1(A, B));

  // S = (B - k * g^x) ^ (a + u * x) mod N
  let base = (bInt - K_MULTIPLIER * modPow(gInt, x, nInt)) % nInt;
  if (base < 0n) {
    base += nInt;
  }
  const S = bigIntToLE(modPow(base, aInt + u * x, nInt), KEY_LENGTH);

  const sessionKey = sha1Interleave(S);

  // M1 = H( (H(N) xor H(g)) || H(I) || s || A || B || K )
  const nHash = sha1(N);
  const gHash = sha1(g);
  const ngHash = new Uint8Array(SHA1_DIGEST_LENGTH);
  for (let i = 0; i < SHA1_DIGEST_LENGTH; i++) {
    ngHash[i] = nHash[i]! ^ gHash[i]!;
  }

  const accountHash = sha1(encoder.encode(upperAccount));
  const M1 = sha1(ngHash, accountHash, salt, A, B, sessionKey);
  const M2 = sha1(A, M1, sessionKey);

  return { A, M1, M2, sessionKey };
};
