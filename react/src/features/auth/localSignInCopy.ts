/** Copy for the local Django sign-in form (ADR-038). */
export const LOCAL_SIGN_IN_COPY = {
  heading: 'Sign in (local development)',
  lead: 'Use a local parent account made with manage.py create_local_parent.',
  username: 'Username',
  password: 'Password',
  submit: 'Sign in',
  submitting: 'Signing in...',
  missing: 'Enter your username and password.',
  refused: 'That username and password did not match.',
  unavailable: 'The local server could not be reached. Check that Django is running.',
} as const;
