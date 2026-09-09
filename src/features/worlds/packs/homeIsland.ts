import { HOME_WORLD_SLUG } from '../slugs';
import type { WorldContentPack } from '../types';

/**
 * Everything the home island owns (docs/ROADMAP.md Phase 29, "content
 * packaging"; explorable-world roadmap section 22).
 *
 * Written out by hand rather than derived from the registries, and that is
 * the whole value of it. A manifest that computed itself would agree with
 * the registries by construction and could never catch anything; this one
 * disagrees the moment someone authors content without deciding which world
 * it belongs to, and `packs.test.ts` fails with the id that went unclaimed.
 */
export const HOME_ISLAND_PACK: WorldContentPack = {
  worldSlug: HOME_WORLD_SLUG,
  version: 1,
  locationSlugs: [
    'pirate-builder-bay',
    'wonderwild-forest',
    'storykeeper-castle',
    'dragons-sanctuary',
    'fossil-ridge-camp',
    'castle-writing-room',
    'bolts-workshop',
    'clockwork-harbor',
  ],
  adventureSlugs: [
    'repair-the-moonlight-bridge',
    'three-planks-for-the-bridge',
    'the-tide-gate-calculation',
    'the-storykeepers-tale',
    'quills-picture-story',
    'buzz-and-the-waggle-dance',
    'dragon-chapter-1-broken-path',
    'dragon-chapter-2-whispering-forest',
    'dragon-chapter-3-dragon-tracks',
    'dragon-chapter-5-save-the-dragon',
    'dino-chapter-1-fossil-dig',
    'dino-chapter-2-footprint-trail',
    'robot-chapter-1-gather-parts',
    'robot-chapter-2-build-it-back',
    'butterfly-chapter-1-quiet-garden',
    'butterfly-chapter-2-plant-the-flowers',
    'secret-door-chapter-1-three-clues',
    'secret-door-chapter-2-pattern-lock',
  ],
  questIds: ['repair-the-bridge', 'tell-a-story-together', 'sort-the-workshop', 'the-quiet-places'],
  itemIds: [
    'spiral-shell',
    'moon-shell',
    'rainbow-shell',
    'singing-shell',
    'beachcomber-hat',
    'bridge-builders-hammer',
    'bee-dance-notebook',
    'storykeepers-quill',
    'ember-scale',
    'friendship-knot',
    'driftwood-key',
    'glowing-moss-jar',
    'glowworm-crystal',
    'blank-page-storybook',
    'explorer-backpack',
    'star-lantern',
  ],
  collectibleSetIds: ['harbor-shells'],
  npcIds: ['pirate-pip', 'keeper-quill', 'bolt', 'ember-dragon'],
  discoveryIds: [
    'harbor-tide-pool',
    'harbor-keepers-door',
    'bay-tide-tunnel',
    'wonderwild-glow-moss',
    'wonderwild-glowworm-cave',
    'castle-tapestry-stair',
  ],
  storySlugs: [
    'dragon-of-ember-mountain',
    'dinosaur-expedition',
    'robot-rescue',
    'save-the-butterfly-garden',
    'the-castles-secret-door',
  ],
};
