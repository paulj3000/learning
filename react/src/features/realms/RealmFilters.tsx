import type { SubjectArea } from '../../api/play/islandsApi';
import { cn } from '../portal/ui';
import {
  SUBJECT_ICONS,
  SUBJECT_LABELS,
  ageBandLabel,
  type AgeBand,
  type RealmFilter,
} from './realmFilters';

interface RealmFiltersProps {
  subjects: readonly SubjectArea[];
  ages: readonly AgeBand[];
  filter: RealmFilter;
  onChange: (filter: RealmFilter) => void;
  shown: number;
  total: number;
}

const CHIP =
  'inline-flex min-h-12 items-center gap-1.5 rounded-full border-2 px-4 text-base font-semibold transition-colors duration-150 motion-reduce:transition-none';
const ON = 'border-ocean-700 bg-ocean-700 text-white';
const OFF = 'border-slate-line bg-paper text-ink hover:border-ocean-500 hover:bg-ocean-50';

/**
 * Subject and age filters (AP-03). Toggle buttons with `aria-pressed`, so each says whether it
 * is on; a live line reads how many Realms are showing. Only options the catalog actually has
 * are offered (`subjectOptions`, `ageOptions`).
 */
export function RealmFilters({
  subjects,
  ages,
  filter,
  onChange,
  shown,
  total,
}: RealmFiltersProps) {
  return (
    <section
      aria-labelledby="realm-filters-heading"
      className="flex w-full flex-col gap-3"
      data-portal="realm-filters"
    >
      <h2 id="realm-filters-heading" className="sr-only">
        Choose what to show
      </h2>
      <div role="group" aria-label="Subject" className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={filter.subject === null}
          className={cn(CHIP, filter.subject === null ? ON : OFF)}
          onClick={() => onChange({ ...filter, subject: null })}
        >
          <span aria-hidden="true">🌍</span>All Realms
        </button>
        {subjects.map((subject) => (
          <button
            key={subject}
            type="button"
            aria-pressed={filter.subject === subject}
            className={cn(CHIP, filter.subject === subject ? ON : OFF)}
            onClick={() => onChange({ ...filter, subject })}
          >
            <span aria-hidden="true">{SUBJECT_ICONS[subject]}</span>
            {SUBJECT_LABELS[subject]}
          </button>
        ))}
      </div>
      {ages.length > 1 ? (
        <div role="group" aria-label="Age" className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={filter.ageBand === null}
            className={cn(CHIP, filter.ageBand === null ? ON : OFF)}
            onClick={() => onChange({ ...filter, ageBand: null })}
          >
            All ages
          </button>
          {ages.map((band) => (
            <button
              key={band}
              type="button"
              aria-pressed={filter.ageBand === band}
              className={cn(CHIP, filter.ageBand === band ? ON : OFF)}
              onClick={() => onChange({ ...filter, ageBand: band })}
            >
              {ageBandLabel(band)}
            </button>
          ))}
        </div>
      ) : null}
      <p className="m-0 text-ink-muted" role="status" aria-live="polite">
        {shown === total
          ? `Showing all ${total} ${total === 1 ? 'Realm' : 'Realms'}`
          : `Showing ${shown} of ${total} Realms`}
      </p>
    </section>
  );
}
