import type { DialogueView } from './dialogueController';

/**
 * Child-facing dialogue copy the client owns. Every other line comes from the published release
 * (authored text only). Each line is short, readable aloud and free of em dashes (CLAUDE.md
 * section 13); kept here, apart from any component, so it can be localized in one place.
 */
export const DIALOGUE_COPY = {
  /** Shown when the interaction API failed: never an error screen. */
  fallback: 'Let us chat again in a little while.',
  /** The button for a node without choices. */
  next: 'Next',
  /** The button that ends a conversation. */
  goodbye: 'Goodbye',
} as const;

/** The calm line to show for a view, or null when the panel shows the server's node. */
export function dialogueFallbackLine(view: Pick<DialogueView, 'fallback'>): string | null {
  return view.fallback ? DIALOGUE_COPY.fallback : null;
}
