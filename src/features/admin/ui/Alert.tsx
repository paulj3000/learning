import type { ComponentProps } from 'react';
import { cn } from './cn';
import { alertVariants, type AlertVariantProps } from './variants';

/**
 * shadcn/ui Alert, minus its hard-coded `role="alert"`. The caller chooses
 * the role: `alert` for errors, `status` for confirmations, none for a
 * warning that should not interrupt a screen reader.
 */
export function Alert({ className, variant, ...props }: ComponentProps<'div'> & AlertVariantProps) {
  return <div data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
