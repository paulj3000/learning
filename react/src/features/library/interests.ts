import { INTEREST_OPTIONS } from '../child-profile/constants';

/**
 * The library's own interest vocabulary, taken verbatim from
 * `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 4's
 * `AdventureInterest` example (docs/ROADMAP.md Phase 15).
 *
 * This is deliberately a *separate* vocabulary from the parent-facing
 * `INTEREST_OPTIONS` a profile is created with: those are broad, friendly
 * words a parent picks from ("Fantasy", "Ocean"), while these are the tags
 * an authored adventure arc carries. `PROFILE_INTEREST_TO_ADVENTURE_INTERESTS`
 * below is the only bridge between them, so adding a library tag never
 * forces a change to the profile form and vice versa.
 *
 * There is no gender signal here, and none is read anywhere in this
 * feature: section 4's rule is that "interests **must not be hard-locked by
 * gender**" and that "interests and actual play behavior should drive
 * recommendations". `ChildProfile` has no gender field at all
 * (docs/DATA_MODEL.md), so this is enforced by the schema, not only by
 * convention.
 */
export const ADVENTURE_INTERESTS = [
  'DRAGONS',
  'DINOSAURS',
  'PIRATES',
  'SPACE',
  'ROBOTS',
  'MAGIC',
  'ANIMALS',
  'FAIRIES',
  'MERMAIDS',
  'CASTLES',
  'BUILDING',
  'MYSTERIES',
  'SCIENCE',
  'ART',
  'MUSIC',
] as const;

export type AdventureInterest = (typeof ADVENTURE_INTERESTS)[number];

type ProfileInterest = (typeof INTEREST_OPTIONS)[number];

/**
 * How a parent-chosen profile interest maps onto library tags. One profile
 * interest can widen into several tags ("Fantasy" covers dragons, magic,
 * fairies, and castles).
 *
 * Some entries are deliberately empty: "Cooking" and "Sports" have no
 * authored arc tagged for them yet, and inventing a loose mapping ("cooking
 * is really SCIENCE") would silently recommend an arc that has nothing to
 * do with what the parent picked. An empty list simply means that interest
 * gives no ranking boost today, which is honest and self-correcting: it
 * starts working the moment an arc for it is authored.
 */
export const PROFILE_INTEREST_TO_ADVENTURE_INTERESTS: Record<
  ProfileInterest,
  readonly AdventureInterest[]
> = {
  Animals: ['ANIMALS'],
  Space: ['SPACE', 'SCIENCE'],
  Dinosaurs: ['DINOSAURS', 'SCIENCE'],
  Ocean: ['PIRATES', 'MERMAIDS'],
  Vehicles: ['ROBOTS', 'BUILDING'],
  Art: ['ART'],
  Music: ['MUSIC'],
  Cooking: [],
  Sports: [],
  Nature: ['ANIMALS', 'SCIENCE'],
  Robots: ['ROBOTS', 'BUILDING'],
  Fantasy: ['DRAGONS', 'MAGIC', 'FAIRIES', 'CASTLES'],
};

function isProfileInterest(value: string): value is ProfileInterest {
  return (INTEREST_OPTIONS as readonly string[]).includes(value);
}

/**
 * Widens a child profile's stored interests into library tags. Unknown
 * strings are ignored rather than throwing: `ChildProfile.interests` is a
 * nullable list of plain strings on the wire, so a row written by an older
 * build (or a later removal from `INTEREST_OPTIONS`) must not break the
 * library.
 */
export function toAdventureInterests(
  profileInterests: readonly (string | null)[] | null | undefined,
): AdventureInterest[] {
  const tags = new Set<AdventureInterest>();
  for (const interest of profileInterests ?? []) {
    if (interest === null || !isProfileInterest(interest)) continue;
    for (const tag of PROFILE_INTEREST_TO_ADVENTURE_INTERESTS[interest]) {
      tags.add(tag);
    }
  }
  return ADVENTURE_INTERESTS.filter((tag) => tags.has(tag));
}
