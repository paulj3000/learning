import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn/ui's class-name helper: joins conditional classes, then lets a
 * caller's Tailwind class override a component's default for the same
 * property (`cn('px-4', 'px-2')` is `'px-2'`, not both).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
