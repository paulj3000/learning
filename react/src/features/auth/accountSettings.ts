/**
 * Sign-in detail changes for the account settings screen. They live in
 * `react/src/api/auth.ts` since LAI-0501A; this module keeps the names the
 * screen already imports.
 */
export {
  changeEmail,
  changePassword,
  confirmEmailChange,
  type EmailChangeResult,
} from '../../api/auth';
