/**
 * Realm Explorer filters (AP-03). Pure: no React, no router.
 *
 * Every option comes from the catalog the server sent: a subject chip exists only when some
 * Realm teaches it, and an age chip only for an age band some Realm supports. Nothing here
 * classifies content; it only matches what Django already said. The state lives in the URL
 * (`?subject=MATH&age=PATHFINDER`), so filtering never reloads the page, the back button
 * works, and a Realm preview can return to the same filtered list.
 */
import { SUBJECT_AREAS, type SubjectArea } from '../../api/play/islandsApi';
import type { Realm } from './realmCatalog';

export const AGE_BANDS = ['SPROUT', 'PATHFINDER', 'EXPLORER'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export interface RealmFilter {
  subject: SubjectArea | null;
  ageBand: AgeBand | null;
}

export const NO_FILTER: RealmFilter = { subject: null, ageBand: null };

/** Child-facing chip words. Readable aloud and localisable; no em dashes. */
export const SUBJECT_LABELS: Record<SubjectArea, string> = {
  MATH: 'Math',
  READING: 'Reading',
  SCIENCE: 'Science',
  CREATIVITY: 'Creativity',
};

export const SUBJECT_ICONS: Record<SubjectArea, string> = {
  MATH: '🔢',
  READING: '📖',
  SCIENCE: '🔬',
  CREATIVITY: '🎨',
};

const BAND_AGES: Record<AgeBand, readonly [number, number]> = {
  SPROUT: [3, 4],
  PATHFINDER: [5, 6],
  EXPLORER: [7, 8],
};

function isAgeBand(value: string): value is AgeBand {
  return (AGE_BANDS as readonly string[]).includes(value);
}

export function ageBandLabel(band: AgeBand): string {
  const [from, to] = BAND_AGES[band];
  return `Ages ${from} to ${to}`;
}

/** "Ages 3 to 8" from a Realm's age bands, or null when it names none this app knows. */
export function ageRangeLabel(bands: readonly string[]): string | null {
  const ranges = bands.filter(isAgeBand).map((band) => BAND_AGES[band]);
  if (ranges.length === 0) return null;
  const low = Math.min(...ranges.map(([from]) => from));
  const high = Math.max(...ranges.map(([, to]) => to));
  return `Ages ${low} to ${high}`;
}

/** The subject chips to offer: those some Realm teaches, in display order. */
export function subjectOptions(realms: readonly Realm[]): SubjectArea[] {
  const taught = new Set(realms.flatMap((realm) => realm.subjectAreas));
  return SUBJECT_AREAS.filter((subject) => taught.has(subject));
}

/** The age chips to offer: the bands some Realm supports, youngest first. */
export function ageOptions(realms: readonly Realm[]): AgeBand[] {
  const supported = new Set(realms.flatMap((realm) => realm.ageBands));
  return AGE_BANDS.filter((band) => supported.has(band));
}

export function matchesFilter(realm: Realm, filter: RealmFilter): boolean {
  if (filter.subject && !realm.subjectAreas.includes(filter.subject)) return false;
  if (filter.ageBand && !realm.ageBands.includes(filter.ageBand)) return false;
  return true;
}

export function filterRealms(realms: readonly Realm[], filter: RealmFilter): Realm[] {
  return realms.filter((realm) => matchesFilter(realm, filter));
}

/** Reads the filter from the URL. Unknown values are ignored rather than showing nothing. */
export function readFilter(params: URLSearchParams): RealmFilter {
  const subject = params.get('subject');
  const age = params.get('age');
  return {
    subject:
      subject && (SUBJECT_AREAS as readonly string[]).includes(subject)
        ? (subject as SubjectArea)
        : null,
    ageBand: age && isAgeBand(age) ? age : null,
  };
}

export function writeFilter(filter: RealmFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.subject) params.set('subject', filter.subject);
  if (filter.ageBand) params.set('age', filter.ageBand);
  return params;
}
