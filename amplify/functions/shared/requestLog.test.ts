import { describe, expect, it, vi } from 'vitest';
import {
  clientAppVersion,
  clientPlatform,
  errorCodeOf,
  formatRequestLog,
  withRequestLog,
} from './requestLog';

describe('clientPlatform', () => {
  it('reads x-app-platform case-insensitively', () => {
    expect(clientPlatform({ 'X-App-Platform': 'android' })).toBe('android');
    expect(clientPlatform({ 'x-app-platform': 'ios' })).toBe('ios');
  });

  it('returns null when absent', () => {
    expect(clientPlatform({})).toBeNull();
    expect(clientPlatform(null)).toBeNull();
    expect(clientPlatform(undefined)).toBeNull();
  });
});

describe('clientAppVersion', () => {
  it('reads x-app-version case-insensitively', () => {
    expect(clientAppVersion({ 'X-App-Version': '1.2.3' })).toBe('1.2.3');
  });

  it('returns null when absent', () => {
    expect(clientAppVersion({})).toBeNull();
  });
});

describe('errorCodeOf', () => {
  it('returns the Error name for a real Error', () => {
    expect(errorCodeOf(new TypeError('bad'))).toBe('TypeError');
  });

  it('returns null for a non-Error throw', () => {
    expect(errorCodeOf('bad')).toBeNull();
  });
});

describe('formatRequestLog', () => {
  it('serializes the entry as JSON', () => {
    const line = formatRequestLog({
      requestId: 'req-1',
      functionName: 'claimCoopSlot',
      childProfileId: 'child-1',
      platform: null,
      appVersion: null,
      result: 'OK',
      errorCode: null,
      durationMs: 12,
    });
    expect(JSON.parse(line)).toEqual({
      requestId: 'req-1',
      functionName: 'claimCoopSlot',
      childProfileId: 'child-1',
      platform: null,
      appVersion: null,
      result: 'OK',
      errorCode: null,
      durationMs: 12,
    });
  });
});

describe('withRequestLog', () => {
  it('logs one OK line and returns the wrapped result on success', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await withRequestLog(
      {
        functionName: 'getNextLearningActivity',
        requestId: 'req-2',
        headers: { 'x-app-platform': 'android' },
        childProfileId: 'child-2',
      },
      async () => 'done',
    );
    expect(result).toBe('done');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      requestId: 'req-2',
      functionName: 'getNextLearningActivity',
      childProfileId: 'child-2',
      platform: 'android',
      result: 'OK',
      errorCode: null,
    });
    expect(typeof entry.durationMs).toBe('number');
    logSpy.mockRestore();
  });

  it('logs one ERROR line and rethrows on failure', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(
      withRequestLog(
        {
          functionName: 'submitAdventureAnswer',
          requestId: 'req-3',
          headers: null,
          childProfileId: null,
        },
        async () => {
          throw new RangeError('nope');
        },
      ),
    ).rejects.toThrow('nope');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      requestId: 'req-3',
      functionName: 'submitAdventureAnswer',
      result: 'ERROR',
      errorCode: 'RangeError',
    });
    logSpy.mockRestore();
  });
});
