import { Navigate } from 'react-router-dom';
import { ChildSignInForm, childHomePath } from '../features/child-auth/ChildSignInForm';
import { useChildSession } from '../features/child-auth/ChildSessionContext';
import { SignInForm } from '../features/auth/SignInForm';
import styles from './SignIn.module.css';

/**
 * `/sign-in`: two clearly separate ways in. A child signs in on their own with the username and
 * password their grown-up set up; a parent signs in with their email (the same form and
 * routes as before). Which one a person used never decides what they may do: the server does.
 */
export function SignIn() {
  const { status, child } = useChildSession();
  if (status === 'signedIn' && child) {
    return <Navigate to={childHomePath(child.id)} replace />;
  }
  return (
    <main className={styles.page} id="main-content">
      <h1 className={styles.title}>Welcome to Learning Adventure Island</h1>
      <div className={styles.grid}>
        <ChildSignInForm headingId="child-sign-in-heading" />
        <SignInForm
          variant="panel"
          headingId="parent-sign-in-heading"
          heading="I am a parent or grown-up"
          lead="Sign in with your email to manage your family, see progress and set up your child's sign-in."
          submitLabel="Family dashboard"
          submittingLabel="Signing in..."
        />
      </div>
    </main>
  );
}
