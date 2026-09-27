import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from './cn';
import { buttonVariants, type ButtonVariantProps } from './variants';

/**
 * shadcn/ui Button. `asChild` renders the single child (usually a router
 * `Link`) with the button's classes instead of a `<button>`, so a link that
 * looks like a button is still a link to assistive technology.
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & ButtonVariantProps & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
