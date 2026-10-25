/**
 * The ids of every extension with a React half (POST-MERGE-03). The view registry itself is
 * React code (`viewExtensions.tsx`); manifest validation runs in the engine and only needs the
 * ids, so they live here as data. `viewExtensions.test.tsx` fails if this list and the registry
 * disagree.
 */
export const VIEW_EXTENSION_IDS: readonly string[] = [
  'tide-trial',
  'adaptive-adventure-entrance',
  'castle-tale',
  'multiplayer-presence',
  'region-play',
];
