import { describe, expect, it } from 'vitest';
import {
  SRP_G,
  SRP_N,
  answerPasswordVerifier,
  derivedKey,
  hexToBytes,
  modPow,
  multiplierK,
  paddedHex,
  poolName,
  privateKeyX,
  scramblerU,
  srpTimestamp,
  startSrp,
} from './srp';

/*
 * Reference vector produced once with the SRP client Amplify v6 shipped
 * (`AuthenticationHelper.getPasswordAuthenticationKey` and
 * `getSignatureString` from @aws-amplify/auth 6.x), so this implementation
 * is pinned to the bytes Cognito already accepts from the deployed app.
 */
const A_HEX =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c' +
  '6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718' +
  '293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const EXPECTED_A =
  '319de7c59b46d165608c21962459554324e58b8bf38e063bc026b6a0d1bd756bc13d4412b7c5dc0d62e617d2' +
  '634098ceb0b8bd9db7baeee8ef1d1d0b297a5e36d5fe014a06dddba54ec10e1907d841566d1faf8772f9e527' +
  '2e080da3314b015587a66229404fdccba681aa355704577be097060f596b97a62306d1011cbd33e61de392c3' +
  '4aab3b7b1aaa59b357e398a26c3f41cc98a3233c85cf91fa70c9e32affba00dbe4c762887bd4f5ae3a835685' +
  '9acc01e3d156ab2a6846f03e65ca7f594070f66d9510d6cf4a7f322a89577e8009efe50bd260fea04bdf518c' +
  '045f2d3718eacb2d78d747cdf2844586b10e64f1b1b4afca1f05dcd341a1291c94d8c477ac32b4f83d325719' +
  '65db0800afc7429ebd6e0c01c1eeb19a94fbc1c10760d0c8d45805edfda26feecc8c9d97cfc1dc84a76c9502' +
  '1ad1569139a9fcba78ea118141551d4ef5c66b8cdfef5043d095ce3fcd8ca63a933c9434e6b47f5b15d9d918' +
  '6073a008640b46aab1c74f2a9bf36e0ddc8a1bce28747e14d35401d30877c3da';
const B_HEX =
  '6efa03ef92613c9bf2d4d9f0fada49529c8cac42eff0c233f58dccf41a76c7279953d4699d88287e5ee25ff5' +
  '964311584c26d00dc212cb2239a671c8832c49cdee66a62be6e83a476855404c845a5c39c50203bddbbc710c' +
  '01edfe9fdda3aae916247ef2714c81098aa0bef1bd5b1724559182b026d793028a4b28a1fd8197946935fea6' +
  'ab1f12a5ed384c99899b71c978810d910abdcf90c7dacc90450afac89c2236585802ea940cb4ee7a00a40c8b' +
  'dc09c8a2a65d3c3f563ca4fedcdbe985919987897c3aa666831e477592545d28bc0a4f15660dddf06b46d1d2' +
  'dc0f623350652b14d891cca459723f568059eff05729c6432f425121706b7e19c547e0eae33b8b3e83b10098' +
  'ef53b1bbf2e6c61c8b5bfaaf3cf497a4e0ea5d328ec42110433e16893988ec7fb719070c80afc8255602678c' +
  '59ddd44602542d33a6a7a8a73fa453847530f58bee570bc9151edb217fbbce8900e04a066bf05fe45cb00ca8' +
  'e23c6f49642c84c22d0d5cc330cca42c9da6a649c50ad5e9fe8901a684d4ce6b';
const SALT = '9f8e7d6c5b4a39281706f5e4d3c2b1a0';
const SECRET_BLOCK = 'c2VjcmV0IGJsb2NrIGJ5dGVzIGZvciB0aGUgdGVzdCB2ZWN0b3I=';
const EXPECTED_KEY = 'fc131e5a388258c071eac4a823dc2208';
const EXPECTED_SIGNATURE = 'tGdJeTVzJHAgeoGWXEO5R3KmCJhVpZtpd7BFadxTRyA=';
const POOL_ID = 'us-west-1_AbCdEf123';
const USER_ID = 'user-id-1234';
const PASSWORD = 'Correct horse 9!';

function fixedBytes(hex: string): (size: number) => Uint8Array {
  return () => hexToBytes(hex);
}

describe('paddedHex', () => {
  it('pads to even length and adds 00 when the top bit is set', () => {
    expect(paddedHex(20n)).toBe('14');
    expect(paddedHex(236n)).toBe('00ec');
    expect(paddedHex(0xfffn)).toBe('0fff');
    expect(paddedHex(0x8000n)).toBe('008000');
  });
  it('refuses negative values', () => {
    expect(() => paddedHex(-1n)).toThrow(RangeError);
  });
});

describe('srpTimestamp', () => {
  it('uses the unpadded day and padded time', () => {
    expect(srpTimestamp(new Date('2026-11-10T09:05:07Z'))).toBe('Tue Nov 10 09:05:07 UTC 2026');
    expect(srpTimestamp(new Date('2026-03-01T23:59:00Z'))).toBe('Sun Mar 1 23:59:00 UTC 2026');
  });
});

describe('poolName', () => {
  it('takes the part after the region', () => {
    expect(poolName(POOL_ID)).toBe('AbCdEf123');
    expect(() => poolName('nounderscore')).toThrow();
  });
});

describe('Cognito SRP against the reference vector', () => {
  it('derives the same A from a fixed a', () => {
    const session = startSrp(fixedBytes(A_HEX));
    expect(session.A.toString(16)).toBe(EXPECTED_A);
  });

  it('derives the same key and signature as the Amplify client', async () => {
    const session = startSrp(fixedBytes(A_HEX));
    const B = BigInt(`0x${B_HEX}`);
    const u = await scramblerU(session.A, B);
    const x = await privateKeyX('AbCdEf123', USER_ID, PASSWORD, BigInt(`0x${SALT}`));
    const k = await multiplierK();
    const base = (((B - k * modPow(SRP_G, x, SRP_N)) % SRP_N) + SRP_N) % SRP_N;
    const S = modPow(base, session.a + u * x, SRP_N);
    const key = await derivedKey(S, u);
    expect(Buffer.from(key).toString('hex')).toBe(EXPECTED_KEY);

    const response = await answerPasswordVerifier({
      session,
      userPoolId: POOL_ID,
      password: PASSWORD,
      challenge: { SRP_B: B_HEX, SALT, SECRET_BLOCK, USER_ID_FOR_SRP: USER_ID },
      now: new Date('2026-11-10T09:05:07Z'),
    });
    expect(response).toEqual({
      USERNAME: USER_ID,
      PASSWORD_CLAIM_SECRET_BLOCK: SECRET_BLOCK,
      PASSWORD_CLAIM_SIGNATURE: EXPECTED_SIGNATURE,
      TIMESTAMP: 'Tue Nov 10 09:05:07 UTC 2026',
    });
  });

  it('gives a different signature for a wrong password', async () => {
    const session = startSrp(fixedBytes(A_HEX));
    const response = await answerPasswordVerifier({
      session,
      userPoolId: POOL_ID,
      password: 'wrong password',
      challenge: { SRP_B: B_HEX, SALT, SECRET_BLOCK, USER_ID_FOR_SRP: USER_ID },
      now: new Date('2026-11-10T09:05:07Z'),
    });
    expect(response.PASSWORD_CLAIM_SIGNATURE).not.toBe(EXPECTED_SIGNATURE);
  });
});

describe('Cognito SRP round trip with a simulated server', () => {
  it('both sides agree on the session key only with the right password', async () => {
    const salt = 0x1234567890abcdefn;
    const x = await privateKeyX('AbCdEf123', USER_ID, PASSWORD, salt);
    const verifier = modPow(SRP_G, x, SRP_N);
    const b = 0xdeadbeefcafef00d1234n;
    const k = await multiplierK();
    const B = (k * verifier + modPow(SRP_G, b, SRP_N)) % SRP_N;

    const client = startSrp();
    const u = await scramblerU(client.A, B);
    const serverS = modPow(client.A * modPow(verifier, u, SRP_N), b, SRP_N);
    const serverKey = await derivedKey(serverS, u);

    const clientS = modPow(
      (((B - k * modPow(SRP_G, x, SRP_N)) % SRP_N) + SRP_N) % SRP_N,
      client.a + u * x,
      SRP_N,
    );
    expect(Buffer.from(await derivedKey(clientS, u)).toString('hex')).toBe(
      Buffer.from(serverKey).toString('hex'),
    );

    const wrongX = await privateKeyX('AbCdEf123', USER_ID, 'nope', salt);
    const wrongS = modPow(
      (((B - k * modPow(SRP_G, wrongX, SRP_N)) % SRP_N) + SRP_N) % SRP_N,
      client.a + u * wrongX,
      SRP_N,
    );
    expect(Buffer.from(await derivedKey(wrongS, u)).toString('hex')).not.toBe(
      Buffer.from(serverKey).toString('hex'),
    );
  });

  it('refuses a zero B', async () => {
    await expect(
      answerPasswordVerifier({
        session: startSrp(),
        userPoolId: POOL_ID,
        password: PASSWORD,
        challenge: { SRP_B: SRP_N.toString(16), SALT, SECRET_BLOCK, USER_ID_FOR_SRP: USER_ID },
        now: new Date(),
      }),
    ).rejects.toThrow();
  });
});
