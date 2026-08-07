const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Enter an email address.';
  if (!EMAIL_PATTERN.test(trimmed)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  return null;
}

export function validateDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter your name.';
  if (trimmed.length > 60) return 'Use 60 characters or fewer.';
  return null;
}

export function validateConfirmationCode(code: string): string | null {
  if (!code.trim()) return 'Enter the confirmation code.';
  return null;
}
