import { defineAuth } from '@aws-amplify/backend';

/**
 * Parent accounts only (ADR-001). Child profiles are application records
 * owned by an authenticated parent, not independent Cognito identities.
 * @see https://docs.amplify.aws/react/build-a-backend/auth/
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
