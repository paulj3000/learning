/**
 * Scoring API types and runtime validators (docs/scoring/SCORING_CONTRACTS.md sections 2 and 6).
 *
 * The client only ever reads scoring. There is no write route and no amount is ever sent:
 * awards are derived on the server from records Django wrote itself. Every response is validated
 * here at runtime (CLAUDE.md section 13); a mismatch becomes `ApiError('invalid_response')`.
 */
import { ApiError } from '../../api/errors';
import { read, type Reader } from '../../api/parse';

export const SCORING_CONTRACT_VERSION = 1;

export const CURRENCIES = ['XP', 'LEARNING_POINTS', 'COINS', 'STAR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const ENTRY_KINDS = ['AWARD', 'CORRECTION'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const SOURCE_KINDS = [
  'ANSWER_CORRECT',
  'LEARNING_CHALLENGE',
  'MASTERY_MILESTONE',
  'LOCATION_FIRST_VISIT',
  'SECRET_DISCOVERED',
  'PICKUP_COLLECTED',
  'PUZZLE_SOLVED',
  'QUEST_COMPLETED',
  'ADVENTURE_COMPLETED',
  'REALM_MILESTONE',
  'REWARD_RULE_GRANTED',
  'ADVENTURE_STAR',
  'JUMP_CHALLENGE',
  'PLATFORM_COURSE',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface ScoringPolicyInfo {
  key: string;
  version: number;
  provisional: boolean;
}

export interface ScoringTotals {
  xp: number;
  learningPoints: number;
  coins: number;
  stars: number;
}

export interface ScoringLevel {
  level: number;
  xp: number;
  levelFloorXp: number;
  /** `null` at the top level. */
  nextLevelXp: number | null;
}

export interface Achievement {
  itemId: string;
  displayName: string;
  description: string;
  acquiredAt: string;
}

export interface Trophy {
  setId: string;
  displayName: string;
  itemId: string;
  acquiredAt: string;
}

export interface PersonalBestRecord {
  xpInOneVisit: number;
}

export interface AdventureScore {
  scopeKey: string;
  xp: number;
  learningPoints: number;
  coins: number;
  stars: number;
  maxStars: number;
  /** `null` when the scope has no session-linked XP. */
  personalBest: PersonalBestRecord | null;
}

export interface SubjectMastery {
  subject: string;
  objectives: number;
  proficient: number;
  mastered: number;
}

export interface AwardEntry {
  id: string;
  entryKind: EntryKind;
  currency: Currency;
  amount: number;
  sourceKind: SourceKind;
  sourceRef: string;
  scopeKey: string;
  recordedAt: string;
}

export interface ScoringDisabledSummary {
  enabled: false;
  contractVersion: number;
}

export interface ScoringEnabledSummary {
  enabled: true;
  contractVersion: number;
  policy: ScoringPolicyInfo;
  totals: ScoringTotals;
  level: ScoringLevel;
  achievements: readonly Achievement[];
  trophies: readonly Trophy[];
  adventures: readonly AdventureScore[];
  subjects: readonly SubjectMastery[];
  recentAwards: readonly AwardEntry[];
}

export type ScoringSummary = ScoringDisabledSummary | ScoringEnabledSummary;

export interface AwardFeed {
  awards: readonly AwardEntry[];
  /** The last entry id in this page, or `null`. */
  cursor: string | null;
  hasMore: boolean;
}

export const DISABLED_SUMMARY: ScoringDisabledSummary = {
  enabled: false,
  contractVersion: SCORING_CONTRACT_VERSION,
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

function nonNegativeInt(r: Reader): number {
  const value = r.integer();
  if (value < 0) throw new ApiError('invalid_response', { code: `expected a count at ${r.path}` });
  return value;
}

function readAward(r: Reader): AwardEntry {
  return {
    id: r.field('id').string(),
    entryKind: r.field('entryKind').oneOf(ENTRY_KINDS),
    currency: r.field('currency').oneOf(CURRENCIES),
    // A CORRECTION may carry a negative amount; the child UI never shows those.
    amount: r.field('amount').integer(),
    sourceKind: r.field('sourceKind').oneOf(SOURCE_KINDS),
    sourceRef: r.field('sourceRef').string(),
    scopeKey: r.field('scopeKey').string(),
    recordedAt: r.field('recordedAt').string(),
  };
}

function readSummary(r: Reader): ScoringSummary {
  const contractVersion = r.field('contractVersion').integer();
  if (!r.field('enabled').boolean()) return { enabled: false, contractVersion };
  const totals = r.field('totals');
  const level = r.field('level');
  const policy = r.field('policy');
  return {
    enabled: true,
    contractVersion,
    policy: {
      key: policy.field('key').string(),
      version: policy.field('version').integer(),
      provisional: policy.field('provisional').boolean(),
    },
    totals: {
      xp: nonNegativeInt(totals.field('xp')),
      learningPoints: nonNegativeInt(totals.field('learningPoints')),
      coins: nonNegativeInt(totals.field('coins')),
      stars: nonNegativeInt(totals.field('stars')),
    },
    level: {
      level: nonNegativeInt(level.field('level')),
      xp: nonNegativeInt(level.field('xp')),
      levelFloorXp: nonNegativeInt(level.field('levelFloorXp')),
      nextLevelXp: level.field('nextLevelXp').nullable(nonNegativeInt),
    },
    achievements: r.field('achievements').array((a) => ({
      itemId: a.field('itemId').string(),
      displayName: a.field('displayName').string(),
      description: a.field('description').string(),
      acquiredAt: a.field('acquiredAt').string(),
    })),
    trophies: r.field('trophies').array((t) => ({
      setId: t.field('setId').string(),
      displayName: t.field('displayName').string(),
      itemId: t.field('itemId').string(),
      acquiredAt: t.field('acquiredAt').string(),
    })),
    adventures: r.field('adventures').array((a) => ({
      scopeKey: a.field('scopeKey').string(),
      xp: nonNegativeInt(a.field('xp')),
      learningPoints: nonNegativeInt(a.field('learningPoints')),
      coins: nonNegativeInt(a.field('coins')),
      stars: nonNegativeInt(a.field('stars')),
      maxStars: nonNegativeInt(a.field('maxStars')),
      personalBest: a
        .field('personalBest')
        .nullable((p) => ({ xpInOneVisit: nonNegativeInt(p.field('xpInOneVisit')) })),
    })),
    subjects: r.field('subjects').array((s) => ({
      subject: s.field('subject').string(),
      objectives: nonNegativeInt(s.field('objectives')),
      proficient: nonNegativeInt(s.field('proficient')),
      mastered: nonNegativeInt(s.field('mastered')),
    })),
    recentAwards: r.field('recentAwards').array(readAward),
  };
}

function readFeed(r: Reader): AwardFeed {
  return {
    awards: r.field('awards').array(readAward),
    cursor: r.field('cursor').nullable((c) => c.string()),
    hasMore: r.field('hasMore').boolean(),
  };
}

function toResult<T>(raw: unknown, parse: (r: Reader) => T): ParseResult<T> {
  try {
    return { ok: true, value: read(raw, parse) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ApiError ? error : new ApiError('invalid_response'),
    };
  }
}

/** Validates a `GET scoring/` response. Never throws. */
export function parseScoringSummary(raw: unknown): ParseResult<ScoringSummary> {
  return toResult(raw, readSummary);
}

/** Validates a `GET scoring/awards/` response. Never throws. */
export function parseAwardFeed(raw: unknown): ParseResult<AwardFeed> {
  return toResult(raw, readFeed);
}
