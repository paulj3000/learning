import { MAX_INTERESTS } from './constants';

export function validateNickname(nickname: string): string | null {
  const trimmed = nickname.trim();
  if (!trimmed) return 'Enter a nickname.';
  if (trimmed.length > 30) return 'Use 30 characters or fewer.';
  return null;
}

export function validateInterests(interests: string[]): string | null {
  if (interests.length > MAX_INTERESTS) return `Choose up to ${MAX_INTERESTS} interests.`;
  return null;
}
