import { cva, type VariantProps } from 'class-variance-authority';

/*
 * Variant recipes for the vendored shadcn/ui components, kept apart from the
 * components so each .tsx file exports only components (react-refresh).
 *
 * Differences from upstream shadcn/ui, deliberate:
 * - No `outline-none` / `focus-visible:ring-*`. The island's global
 *   `:focus-visible` outline (global.css, 3px in the tested focus-ring
 *   colour) is kept, so keyboard focus looks the same in admin as elsewhere.
 * - No `dark:` variants. The app has no dark mode.
 * - Alert text stays `text-foreground` on every variant: the tinted
 *   backgrounds are for scanning, and body text colour is the pair
 *   tokens.test.ts guarantees.
 */

export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'bg-destructive text-primary-foreground shadow-xs hover:bg-destructive/90',
        outline:
          'border border-input bg-card shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 gap-1.5 px-3',
        lg: 'h-10 px-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeVariantProps = VariantProps<typeof badgeVariants>;

export const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm text-foreground',
  {
    variants: {
      variant: {
        default: 'bg-card',
        destructive: 'border-destructive bg-destructive/10',
        warning: 'border-warning bg-warning/10',
        success: 'border-success bg-success/10',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type AlertVariantProps = VariantProps<typeof alertVariants>;

/** Shared by Input, Textarea and NativeSelect. */
export const fieldControlClass =
  'w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-base shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';
