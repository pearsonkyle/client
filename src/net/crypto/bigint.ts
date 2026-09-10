// BigInt helpers for SRP6.
//
// Every big number on the auth wire is a little-endian byte array of a big-endian
// integer, so conversion always goes through a reverse.

export const bigIntFromLE = (bytes: Uint8Array): bigint => {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    value = (value << 8n) | BigInt(bytes[i]!);
  }
  return value;
};

// Little-endian bytes, zero-padded (or truncated) to `size`.
export const bigIntToLE = (value: bigint, size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  let rest = value;
  for (let i = 0; i < size; i++) {
    bytes[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
};

// Right-to-left binary modular exponentiation.
export const modPow = (base: bigint, exponent: bigint, modulus: bigint): bigint => {
  if (modulus === 1n) {
    return 0n;
  }
  let result = 1n;
  let b = base % modulus;
  if (b < 0n) {
    b += modulus;
  }
  let e = exponent;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % modulus;
    }
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
};

export const randomBytes = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
};
