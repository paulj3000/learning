/**
 * Cognito's SRP-6a password verification (the `USER_SRP_AUTH` flow), written
 * against the Web Crypto API and native `BigInt` so the app needs no auth
 * library (AMP-02). The password never leaves the browser: only the proof
 * built here does.
 *
 * The constants and byte layouts are Cognito's, and match the reference
 * client Amplify v6 shipped (`getPaddedHex`, `calculateU`, `calculateS`,
 * `getHkdfKey`, `getSignatureString`). `srp.test.ts` pins them with a
 * vector produced by that client and with a full client/server round trip.
 */

/** The 3072-bit group prime (RFC 5054). */
const N_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
  'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64' +
  'ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
  'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B' +
  'F12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
  'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31' +
  '43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF';

export const SRP_N = BigInt(`0x${N_HEX}`);
export const SRP_G = 2n;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const encoder = new TextEncoder();

// --- encoding --------------------------------------------------------------------------------

/**
 * Even-length hex of a non-negative integer, with a leading `00` when the
 * top bit is set (Java `BigInteger.toByteArray`, which Cognito uses).
 */
export function paddedHex(value: bigint): string {
  if (value < 0n) throw new RangeError('SRP values are never negative here');
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  if (/^[89a-f]/i.test(hex)) hex = `00${hex}`;
  return hex;
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) throw new RangeError('odd-length hex');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

// --- primitives --------------------------------------------------------------------------------

function subtle(): SubtleCrypto {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) throw new Error('Web Crypto is not available');
  return crypto.subtle;
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().digest('SHA-256', data));
}

/** SHA-256 of the bytes a hex string encodes, as 64 hex digits. */
export async function hashHex(hex: string): Promise<string> {
  return bytesToHex(await sha256(hexToBytes(hex)));
}

async function hmac(
  key: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const imported = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await subtle().sign('HMAC', imported, data));
}

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = ((base % modulus) + modulus) % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

/** k = H(PAD(N) | PAD(g)). */
export async function multiplierK(): Promise<bigint> {
  return BigInt(`0x${await hashHex(paddedHex(SRP_N) + paddedHex(SRP_G))}`);
}

/** u = H(PAD(A) | PAD(B)). */
export async function scramblerU(A: bigint, B: bigint): Promise<bigint> {
  const u = BigInt(`0x${await hashHex(paddedHex(A) + paddedHex(B))}`);
  if (u === 0n) throw new Error('SRP scrambler is zero');
  return u;
}

/** The pool part of a user pool id: `us-west-1_AbC` becomes `AbC`. */
export function poolName(userPoolId: string): string {
  const name = userPoolId.split('_')[1];
  if (!name) throw new Error('Invalid user pool id');
  return name;
}

/** x = H(PAD(salt) | H(poolName | userId | ":" | password)). */
export async function privateKeyX(
  pool: string,
  userId: string,
  password: string,
  salt: bigint,
): Promise<bigint> {
  const inner = bytesToHex(await sha256(encoder.encode(`${pool}${userId}:${password}`)));
  return BigInt(`0x${await hashHex(paddedHex(salt) + inner)}`);
}

/** Cognito's timestamp: `ddd MMM D HH:mm:ss UTC YYYY`, day of month not padded. */
export function srpTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ` +
    `UTC ${date.getUTCFullYear()}`
  );
}

// --- the client side of one sign-in --------------------------------------------------------------

export interface SrpSession {
  /** The client secret `a`; kept only for the one challenge it answers. */
  a: bigint;
  /** The public value `A`, sent as `SRP_A` (unpadded lowercase hex). */
  A: bigint;
}

/** Starts a sign-in: a fresh random `a` and its `A = g^a mod N`. */
export function startSrp(
  randomBytes: (size: number) => Uint8Array = defaultRandomBytes,
): SrpSession {
  for (;;) {
    const a = BigInt(`0x${bytesToHex(randomBytes(128))}`) % SRP_N;
    if (a === 0n) continue;
    const A = modPow(SRP_G, a, SRP_N);
    if (A % SRP_N !== 0n) return { a, A };
  }
}

function defaultRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export interface PasswordVerifierChallenge {
  SRP_B: string;
  SALT: string;
  SECRET_BLOCK: string;
  USER_ID_FOR_SRP: string;
}

export interface PasswordVerifierResponse {
  USERNAME: string;
  PASSWORD_CLAIM_SECRET_BLOCK: string;
  PASSWORD_CLAIM_SIGNATURE: string;
  TIMESTAMP: string;
}

/** The 16-byte key both sides derive from S: HKDF(ikm=PAD(S), salt=PAD(u), "Caldera Derived Key"). */
export async function derivedKey(S: bigint, u: bigint): Promise<Uint8Array<ArrayBuffer>> {
  const prk = await hmac(hexToBytes(paddedHex(u)), hexToBytes(paddedHex(S)));
  const info = concat(encoder.encode('Caldera Derived Key'), new Uint8Array([1]));
  return (await hmac(prk, info)).slice(0, 16);
}

/**
 * Answers Cognito's `PASSWORD_VERIFIER` challenge for `session`. `now` is
 * the signing time (Cognito accepts a few minutes of skew).
 */
export async function answerPasswordVerifier(input: {
  session: SrpSession;
  userPoolId: string;
  password: string;
  challenge: PasswordVerifierChallenge;
  now: Date;
}): Promise<PasswordVerifierResponse> {
  const { session, challenge } = input;
  const B = BigInt(`0x${challenge.SRP_B}`);
  if (B % SRP_N === 0n) throw new Error('SRP B is zero');
  const salt = BigInt(`0x${challenge.SALT}`);
  const pool = poolName(input.userPoolId);
  const userId = challenge.USER_ID_FOR_SRP;

  const [k, u, x] = await Promise.all([
    multiplierK(),
    scramblerU(session.A, B),
    privateKeyX(pool, userId, input.password, salt),
  ]);
  const base = (((B - k * modPow(SRP_G, x, SRP_N)) % SRP_N) + SRP_N) % SRP_N;
  const S = modPow(base, session.a + u * x, SRP_N);
  const key = await derivedKey(S, u);

  const timestamp = srpTimestamp(input.now);
  const message = concat(
    encoder.encode(pool),
    encoder.encode(userId),
    base64ToBytes(challenge.SECRET_BLOCK),
    encoder.encode(timestamp),
  );
  return {
    USERNAME: userId,
    PASSWORD_CLAIM_SECRET_BLOCK: challenge.SECRET_BLOCK,
    PASSWORD_CLAIM_SIGNATURE: bytesToBase64(await hmac(key, message)),
    TIMESTAMP: timestamp,
  };
}
