import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins conditional class names, then lets a caller's Tailwind class override
 * a component's default for the same property. The portal's own copy: ADR-023
 * forbids child- and parent-facing code from importing `features/admin/ui`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
