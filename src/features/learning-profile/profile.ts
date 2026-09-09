import {
  domainForSkill,
  LEARNING_DOMAINS,
  type DomainProfile,
  type LearningDomain,
  type LearningProfile,
  type SkillEvidenceInput,
  type SkillLevel,
} from './types';

/**
 * Computing a `LearningProfile` from evidence the island already records
 * (`docs/regions/clockwork.md` section 7). See `types.ts` for why this is
 * derived from `SkillProgress` rather than stored alongside it.
 *
 * Every threshold here is an initial deterministic guess, not a
 * pedagogically validated model - the same honesty
 * `src/features/mastery/status.ts` states about its own constants. They are
 * gathered at the top so they can be retuned without touching call sites.
 */

/**
 * Successes needed to reach each level, cumulative.
 *
 * Index `i` is the number of independent successes at which a domain reaches
 * level `i + 1`, so a domain with no evidence sits at level 1 and a domain
 * with 24 independent successes sits at level 5.
 */
const LEVEL_SUCCESS_THRESHOLDS: readonly number[] = [0, 3, 8, 15, 24];

/**
 * The ceiling `computeLearningProfile` will promote a child to on evidence
 * alone.
 *
 * Level 6 is section 7's open-ended "Challenge Levels" band. Nothing
 * auto-promotes into it: "open-ended and increasingly complex challenges" is a
 * judgement authored content makes, not something a success counter should
 * decide on a child's behalf.
 */
export const MAX_DERIVED_LEVEL: SkillLevel = 5;

/** Attempts at which a domain's level is considered fully settled. */
const CONFIDENCE_SATURATION_ATTEMPTS = 12;

/**
 * A domain nobody has practiced. Level 1, no confidence, no attempts - which
 * reads as "we have not seen this child do this", never as "this child is bad
 * at this".
 */
function emptyDomainProfile(domain: LearningDomain): DomainProfile {
  return { domain, level: 1, confidence: 0, attempts: 0, successes: 0 };
}

/** Whether the island has ever seen this child attempt anything in a domain. */
export function hasEvidence(profile: DomainProfile): boolean {
  return profile.attempts > 0;
}

function levelForSuccesses(successes: number): SkillLevel {
  let level = 1;
  for (let index = 1; index < LEVEL_SUCCESS_THRESHOLDS.length; index += 1) {
    if (successes >= LEVEL_SUCCESS_THRESHOLDS[index]) level = index + 1;
  }
  return Math.min(level, MAX_DERIVED_LEVEL) as SkillLevel;
}

/**
 * How settled a level is, 0-1.
 *
 * Grows with the volume of evidence and is dampened when the child's success
 * ratio is middling, since a domain the child gets right half the time is one
 * where the right level is genuinely unclear. Deliberately not the success
 * ratio itself: see `DomainProfile.confidence`.
 */
function confidenceFor(attempts: number, successes: number): number {
  if (attempts === 0) return 0;
  const volume = Math.min(1, attempts / CONFIDENCE_SATURATION_ATTEMPTS);
  const ratio = successes / attempts;
  // Peaks at a clear signal in either direction (consistently right, or
  // consistently not yet), lowest at a 50/50 coin flip.
  const clarity = Math.abs(ratio - 0.5) * 2;
  return Number((volume * (0.5 + clarity * 0.5)).toFixed(4));
}

/**
 * Aggregates per-skill evidence into the six domains.
 *
 * `independentSuccessCount` alone counts as a success; supported successes
 * count toward `attempts` but not toward level, matching the Mastery Engine's
 * rule that independent competence is what moves a child up. Evidence for a
 * skill with no domain mapping is skipped rather than dropped into a default
 * bucket, so an unmapped skill shows up as a gap in `unmappedSkills` instead of
 * quietly inflating one domain.
 */
export function computeLearningProfile(evidence: readonly SkillEvidenceInput[]): LearningProfile {
  const totals = new Map<LearningDomain, { attempts: number; successes: number }>();
  for (const domain of LEARNING_DOMAINS) totals.set(domain, { attempts: 0, successes: 0 });

  for (const entry of evidence) {
    const domain = domainForSkill(entry.skillId);
    if (!domain) continue;
    const bucket = totals.get(domain);
    if (!bucket) continue;
    bucket.attempts += entry.counts.exposureCount;
    bucket.successes += entry.counts.independentSuccessCount;
  }

  const domains = {} as Record<LearningDomain, DomainProfile>;
  for (const domain of LEARNING_DOMAINS) {
    const bucket = totals.get(domain) ?? { attempts: 0, successes: 0 };
    domains[domain] = bucket.attempts
      ? {
          domain,
          level: levelForSuccesses(bucket.successes),
          confidence: confidenceFor(bucket.attempts, bucket.successes),
          attempts: bucket.attempts,
          successes: bucket.successes,
        }
      : emptyDomainProfile(domain);
  }

  return { domains };
}

/** Convenience accessor, so callers do not index a record inline at every call site. */
export function domainProfile(profile: LearningProfile, domain: LearningDomain): DomainProfile {
  return profile.domains[domain];
}
