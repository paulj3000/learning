import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Portal button styles (AP-01).
 *
 * - Every size is at least 48px tall, the touch-target floor in
 *   docs/UX_AND_ACCESSIBILITY.md; `lg` (56px) is for primary child actions.
 * - Colour only. Shape, weight and the pressable lip come from global.css's
 *   bare `button` rules, which portal buttons deliberately keep. A link
 *   rendered through `asChild` gets the same shape from `rounded-2xl`.
 * - No `outline-none`: the island's focus ring in global.css stays visible.
 * - Every foreground/background pair is checked in `portalCss.test.ts`.
 */
export const portalButtonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-2xl px-5 text-center font-semibold no-underline select-none disabled:cursor-not-allowed',
  {
    variants: {
      tone: {
        ocean: 'bg-ocean-700 text-white',
        tropical: 'bg-tropical-700 text-white',
        treasure: 'bg-treasure-300 text-ink',
        coral: 'bg-coral-700 text-white',
        purple: 'bg-purple-700 text-white',
        quiet: 'border-2 border-slate-line bg-paper text-ink',
      },
      size: {
        md: 'min-h-12 text-base',
        lg: 'min-h-14 px-6 text-lg',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { tone: 'ocean', size: 'md', block: false },
  },
);

export type PortalButtonVariantProps = VariantProps<typeof portalButtonVariants>;

export const portalCardVariants = cva(
  'flex flex-col gap-2 rounded-3xl border-2 p-5 text-ink shadow-sm',
  {
    variants: {
      tone: {
        ocean: 'border-ocean-100 bg-ocean-50',
        tropical: 'border-tropical-100 bg-tropical-50',
        treasure: 'border-treasure-100 bg-treasure-50',
        coral: 'border-coral-100 bg-coral-50',
        purple: 'border-purple-100 bg-purple-50',
        plain: 'border-slate-line bg-paper',
      },
    },
    defaultVariants: { tone: 'plain' },
  },
);

export type PortalCardVariantProps = VariantProps<typeof portalCardVariants>;

/**
 * Fill colour of a progress track, matched to the card tones. Each meets the
 * 3:1 non-text contrast floor against the paper track (`portalCss.test.ts`),
 * which is why treasure and coral use their deeper shades.
 */
export const PROGRESS_FILL = {
  ocean: 'bg-ocean-500',
  tropical: 'bg-tropical-500',
  treasure: 'bg-treasure-800',
  coral: 'bg-coral-700',
  purple: 'bg-purple-500',
} as const;

export type ProgressTone = keyof typeof PROGRESS_FILL;
