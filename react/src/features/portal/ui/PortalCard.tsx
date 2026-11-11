import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';
import { portalCardVariants, type PortalCardVariantProps } from './variants';

export type PortalCardProps = ComponentPropsWithoutRef<'div'> &
  PortalCardVariantProps & {
    /** `section` or `article` when the card is a landmark of its own; `div` otherwise. */
    as?: 'div' | 'section' | 'article';
  };

/**
 * A rounded, colour-washed surface for a portal destination, quest or summary
 * (AP-01). Presentational only: a card that navigates puts a `PortalButton`
 * or a link inside it rather than becoming a clickable div.
 */
export function PortalCard({ className, tone, as = 'div', ...props }: PortalCardProps) {
  const Component = as;
  return (
    <Component
      data-slot="portal-card"
      className={cn(portalCardVariants({ tone }), className)}
      {...props}
    />
  );
}
