import { cognitoAuth } from '../../lib/cognito';

export interface EmailChangeResult {
  needsConfirmation: boolean;
}

/**
 * Cognito sends a confirmation code to the new address before the change
 * takes effect; call `confirmEmailChange` with that code to complete it.
 */
export async function changeEmail(newEmail: string): Promise<EmailChangeResult> {
  return { needsConfirmation: await cognitoAuth().updateEmail(newEmail) };
}

export async function confirmEmailChange(confirmationCode: string): Promise<void> {
  await cognitoAuth().confirmEmail(confirmationCode);
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await cognitoAuth().changePassword(oldPassword, newPassword);
}
