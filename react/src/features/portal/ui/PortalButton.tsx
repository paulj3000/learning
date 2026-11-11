import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from './cn';
import { portalButtonVariants, type PortalButtonVariantProps } from './variants';

export type PortalButtonProps = ComponentProps<'button'> &
  PortalButtonVariantProps & {
    /** Render the single child (usually a router `Link`) with the button's classes. */
    asChild?: boolean;
  };

/**
 * The portal's button (AP-01). A real `<button>` by default, `type="button"`
 * unless told otherwise so it never submits a form by accident; with
 * `asChild` a link that looks like a button stays a link to assistive
 * technology (CLAUDE.md section 13: accessible buttons over clickable divs).
 */
export function PortalButton({
  className,
  tone,
  size,
  block,
  asChild = false,
  type,
  ...props
}: PortalButtonProps) {
  if (asChild) {
    return (
      <Slot
        data-slot="portal-button"
        className={cn(portalButtonVariants({ tone, size, block }), className)}
        {...props}
      />
    );
  }
  return (
    <button
      data-slot="portal-button"
      type={type ?? 'button'}
      className={cn(portalButtonVariants({ tone, size, block }), className)}
      {...props}
    />
  );
}
