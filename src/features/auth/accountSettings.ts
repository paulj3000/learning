import {
  confirmUserAttribute,
  updatePassword as amplifyUpdatePassword,
  updateUserAttributes,
} from 'aws-amplify/auth';

export interface EmailChangeResult {
  needsConfirmation: boolean;
}

/**
 * Cognito sends a confirmation code to the new address before the change
 * takes effect; call `confirmEmailChange` with that code to complete it.
 */
export async function changeEmail(newEmail: string): Promise<EmailChangeResult> {
  const output = await updateUserAttributes({
    userAttributes: { email: newEmail },
  });
  const step = output.email?.nextStep.updateAttributeStep;
  return { needsConfirmation: step === 'CONFIRM_ATTRIBUTE_WITH_CODE' };
}

export async function confirmEmailChange(confirmationCode: string): Promise<void> {
  await confirmUserAttribute({ userAttributeKey: 'email', confirmationCode });
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await amplifyUpdatePassword({ oldPassword, newPassword });
}
