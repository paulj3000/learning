import { describe, expect, it } from 'vitest';
import { AuthError } from '../../api/auth';
import { describeAuthError, isIncorrectPassword } from './errors';

describe('describeAuthError', () => {
  it('reads the code of a typed AuthError', () => {
    expect(describeAuthError(new AuthError('CodeMismatchException'))).toBe(
      'That confirmation code is not correct. Please try again.',
    );
  });

  it('still reads a raw Cognito error by name', () => {
    const error = Object.assign(new Error('x'), { name: 'UserNotFoundException' });
    expect(describeAuthError(error)).toBe('We could not find an account with that email.');
  });

  it('falls back to a generic message', () => {
    expect(describeAuthError(new AuthError('unknown'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('isIncorrectPassword', () => {
  it('recognises the wrong current password from the typed error and from a raw one', () => {
    expect(isIncorrectPassword(new AuthError('NotAuthorizedException'))).toBe(true);
    expect(
      isIncorrectPassword(Object.assign(new Error('x'), { name: 'NotAuthorizedException' })),
    ).toBe(true);
    expect(isIncorrectPassword(new AuthError('LimitExceededException'))).toBe(false);
  });
});
