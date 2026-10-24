import type { JsonValue } from '../../runtime/locationManifest';

/**
 * The `adaptive-adventure-entrance` extension's config: one spot in the
 * world that opens whichever authored variant of an adventure this child's
 * demonstrated skill is ready for (`docs/regions/clockwork.md` section 2.2,
 * "One World, Multiple Skill Levels").
 *
 * A plain `START_ADVENTURE` interaction cannot say this: it names one
 * template slug, and `resolveAdventureForAgeBand` picks by age. This names a
 * *set* of variants and a learning domain, and the selection happens through
 * the existing Adaptive engine (`src/features/adaptive/selection.ts`).
 */
export interface AdaptiveAdventureEntranceConfig {
  /** The interaction this extension takes over. */
  interactionId: string;
  /** The dialog's child-facing name, since the overlay replaces the authored panel. */
  title: string;
  locationSlug: string;
  /** The authored variant slugs to choose between, all for this location. */
  variantSlugs: readonly string[];
  /** Which `LearningDomain` the child's readiness is read from. */
  domain: string;
  /** Once this world change is recorded, the machine is already running. */
  completedChangeKey: string;
  /** What the child is told when it is already running, and when no variant fits. */
  completedMessage: string;
  unavailableMessage: string;
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Parses config, or `null` so a broken binding is skipped rather than trusted. */
export function tryParseAdaptiveEntranceConfig(config: {
  readonly [key: string]: JsonValue;
}): AdaptiveAdventureEntranceConfig | null {
  const interactionId = text(config.interactionId);
  const title = text(config.title);
  const locationSlug = text(config.locationSlug);
  const domain = text(config.domain);
  const completedChangeKey = text(config.completedChangeKey);
  const completedMessage = text(config.completedMessage);
  const unavailableMessage = text(config.unavailableMessage);
  const variantSlugs = config.variantSlugs;
  if (!interactionId || !title || !locationSlug || !domain) return null;
  if (!completedChangeKey || !completedMessage || !unavailableMessage) return null;
  if (!Array.isArray(variantSlugs) || variantSlugs.length === 0) return null;
  if (!variantSlugs.every((slug) => typeof slug === 'string' && slug.length > 0)) return null;
  return {
    interactionId,
    title,
    locationSlug,
    variantSlugs: variantSlugs as readonly string[],
    domain,
    completedChangeKey,
    completedMessage,
    unavailableMessage,
  };
}
