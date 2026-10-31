import { useAuth } from '../features/auth/AuthContext';
import { LocalSignInForm } from '../features/auth/LocalSignInForm';
import { SignInForm } from '../features/auth/SignInForm';

/** The Amplify form, or the local Django one in a `VITE_AUTH_PROVIDER=django` build (ADR-038). */
export function SignIn() {
  const { mode } = useAuth();
  return mode === 'django' ? <LocalSignInForm /> : <SignInForm />;
}
