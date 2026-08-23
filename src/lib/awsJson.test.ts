import { describe, expect, it } from 'vitest';
import { decodeAwsJson, encodeAwsJson } from './awsJson';

describe('encodeAwsJson', () => {
  it('produces a string, which is what AppSync accepts for an AWSJSON variable', () => {
    expect(typeof encodeAwsJson({ a: true })).toBe('string');
    expect(encodeAwsJson({ a: true })).toBe('{"a":true}');
  });

  it('round-trips through decode', () => {
    const value = { flags: { met: true }, list: [1, 'two'] };
    expect(decodeAwsJson(encodeAwsJson(value))).toEqual(value);
  });
});

describe('decodeAwsJson', () => {
  it('parses the JSON string a live read returns', () => {
    expect(decodeAwsJson('{"met":true}')).toEqual({ met: true });
  });

  it('passes an already-decoded value straight through', () => {
    expect(decodeAwsJson({ met: true })).toEqual({ met: true });
    expect(decodeAwsJson([1, 2])).toEqual([1, 2]);
  });

  it('degrades malformed JSON to null rather than throwing', () => {
    expect(decodeAwsJson('{not json')).toBeNull();
  });

  it('leaves null and undefined alone', () => {
    expect(decodeAwsJson(null)).toBeNull();
    expect(decodeAwsJson(undefined)).toBeUndefined();
  });
});
