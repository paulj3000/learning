import { describe, expect, it } from 'vitest';
import {
  validateConfirmationCode,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from './validators';

describe('validateEmail', () => {
  it('rejects empty input', () => {
    expect(validateEmail('')).toMatch(/enter an email/i);
  });

  it('rejects input without an @', () => {
    expect(validateEmail('not-an-email')).toMatch(/valid email/i);
  });

  it('accepts a well-formed email', () => {
    expect(validateEmail('parent@example.com')).toBeNull();
  });
});

describe('validatePassword', () => {
  it('rejects passwords shorter than 8 characters', () => {
    expect(validatePassword('short')).toMatch(/8 characters/i);
  });

  it('accepts an 8+ character password', () => {
    expect(validatePassword('longenough')).toBeNull();
  });
});

describe('validateDisplayName', () => {
  it('rejects empty or whitespace-only input', () => {
    expect(validateDisplayName('   ')).toMatch(/enter your name/i);
  });

  it('rejects names longer than 60 characters', () => {
    expect(validateDisplayName('a'.repeat(61))).toMatch(/60 characters/i);
  });

  it('accepts a normal name', () => {
    expect(validateDisplayName('Ada')).toBeNull();
  });
});

describe('validateConfirmationCode', () => {
  it('rejects empty input', () => {
    expect(validateConfirmationCode('')).toMatch(/enter the confirmation code/i);
  });

  it('accepts a non-empty code', () => {
    expect(validateConfirmationCode('123456')).toBeNull();
  });
});
