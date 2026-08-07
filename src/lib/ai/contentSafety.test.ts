import { describe, expect, it } from 'vitest';
import { containsUrl, requestsPersonalInformation } from './contentSafety';

describe('containsUrl', () => {
  it('flags http(s) links', () => {
    expect(containsUrl('Check this out: https://example.com')).toBe(true);
  });

  it('flags bare domains', () => {
    expect(containsUrl('Visit example.com for more')).toBe(true);
  });

  it('allows ordinary sentences', () => {
    expect(containsUrl('The bridge has three missing planks.')).toBe(false);
  });
});

describe('requestsPersonalInformation', () => {
  it('flags requests for a password', () => {
    expect(requestsPersonalInformation('What is your password?')).toBe(true);
  });

  it('flags requests for a home address', () => {
    expect(requestsPersonalInformation('Can you tell me your home address?')).toBe(true);
  });

  it('flags requests for a school name', () => {
    expect(requestsPersonalInformation("What's your school's name?")).toBe(true);
  });

  it('allows ordinary encouragement', () => {
    expect(requestsPersonalInformation('Great job counting those planks!')).toBe(false);
  });
});
