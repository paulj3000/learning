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

/**
 * Calls `listener(reduced)` whenever the system's `prefers-reduced-motion` changes during a visit
 * (the child or a parent toggles it in system settings). Returns the unsubscribe. There is no
 * separate in-app motion setting: the system preference is the single source. Safe where
 * `matchMedia` is missing (no events, a no-op unsubscribe).
 */
export function subscribeReducedMotion(listener: (reduced: boolean) => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onChange = (event: { matches: boolean }) => listener(event.matches);
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }
  // Older Safari only has the deprecated pair.
  query.addListener?.(onChange);
  return () => query.removeListener?.(onChange);
}
