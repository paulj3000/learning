import type { ComponentProps } from 'react';
import { cn } from './cn';
import { badgeVariants, type BadgeVariantProps } from './variants';

/** shadcn/ui Badge: a short status label, such as "Draft" or "Active". */
export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & BadgeVariantProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
