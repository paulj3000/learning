import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  updateEmail: vi.fn(),
  confirmEmail: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('../../lib/cognito', () => ({ cognitoAuth: () => fake, isCognitoConfigured: true }));

import { changeEmail, changePassword, confirmEmailChange } from './accountSettings';

beforeEach(() => {
  fake.updateEmail.mockReset();
  fake.confirmEmail.mockReset();
  fake.changePassword.mockReset();
});

describe('changeEmail', () => {
  it('reports needsConfirmation when Cognito sent a confirmation code', async () => {
    fake.updateEmail.mockResolvedValueOnce(true);
    expect(await changeEmail('new@example.com')).toEqual({ needsConfirmation: true });
    expect(fake.updateEmail).toHaveBeenCalledWith('new@example.com');
  });

  it('reports no confirmation needed when the update completes immediately', async () => {
    fake.updateEmail.mockResolvedValueOnce(false);
    expect(await changeEmail('new@example.com')).toEqual({ needsConfirmation: false });
  });
});

describe('confirmEmailChange', () => {
  it('confirms the email attribute with the given code', async () => {
    await confirmEmailChange('123456');
    expect(fake.confirmEmail).toHaveBeenCalledWith('123456');
  });
});

describe('changePassword', () => {
  it('passes the old and new password through to Cognito', async () => {
    await changePassword('old-pass', 'new-pass');
    expect(fake.changePassword).toHaveBeenCalledWith('old-pass', 'new-pass');
  });
});
