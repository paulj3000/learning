/**
 * Shared `prefers-reduced-motion` check (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 42). Used by both the Canvas 2D companion portrait and the Phaser
 * world engine so the two independent renderers agree on when to skip
 * decorative animation.
 */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}
