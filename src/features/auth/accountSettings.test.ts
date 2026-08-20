import { describe, expect, it, vi, beforeEach } from 'vitest';

const { confirmUserAttribute, updatePassword, updateUserAttributes } = vi.hoisted(() => ({
  confirmUserAttribute: vi.fn(),
  updatePassword: vi.fn(),
  updateUserAttributes: vi.fn(),
}));

vi.mock('aws-amplify/auth', () => ({
  confirmUserAttribute,
  updatePassword,
  updateUserAttributes,
}));

import { changeEmail, changePassword, confirmEmailChange } from './accountSettings';

describe('changeEmail', () => {
  beforeEach(() => {
    updateUserAttributes.mockReset();
  });

  it('reports needsConfirmation when Cognito requires a confirmation code', async () => {
    updateUserAttributes.mockResolvedValueOnce({
      email: { isUpdated: false, nextStep: { updateAttributeStep: 'CONFIRM_ATTRIBUTE_WITH_CODE' } },
    });

    const result = await changeEmail('new@example.com');

    expect(updateUserAttributes).toHaveBeenCalledWith({
      userAttributes: { email: 'new@example.com' },
    });
    expect(result).toEqual({ needsConfirmation: true });
  });

  it('reports no confirmation needed when the update completes immediately', async () => {
    updateUserAttributes.mockResolvedValueOnce({
      email: { isUpdated: true, nextStep: { updateAttributeStep: 'DONE' } },
    });

    const result = await changeEmail('new@example.com');

    expect(result).toEqual({ needsConfirmation: false });
  });
});

describe('confirmEmailChange', () => {
  it('confirms the email attribute with the given code', async () => {
    confirmUserAttribute.mockReset();
    await confirmEmailChange('123456');
    expect(confirmUserAttribute).toHaveBeenCalledWith({
      userAttributeKey: 'email',
      confirmationCode: '123456',
    });
  });
});

describe('changePassword', () => {
  it('passes the old and new password through to Amplify', async () => {
    updatePassword.mockReset();
    await changePassword('old-pass', 'new-pass');
    expect(updatePassword).toHaveBeenCalledWith({ oldPassword: 'old-pass', newPassword: 'new-pass' });
  });
});
