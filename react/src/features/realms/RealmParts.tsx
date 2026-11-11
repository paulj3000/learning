import type { SubjectArea } from '../../api/play/islandsApi';
import { ChildAvatar } from '../child-profile/ChildAvatar';
import type { ChildProfile } from '../child-profile/api';
import { cn } from '../portal/ui';
import { SUBJECT_ICONS, SUBJECT_LABELS, ageRangeLabel } from './realmFilters';

/** "Learn: Math, Science". Chips are read once, as one list, not chip by chip. */
export function SubjectBadges({
  subjects,
  className,
}: {
  subjects: readonly SubjectArea[];
  className?: string;
}) {
  if (subjects.length === 0) return null;
  return (
    <ul
      className={cn('m-0 flex list-none flex-wrap gap-1.5 p-0', className)}
      aria-label={`Learn: ${subjects.map((subject) => SUBJECT_LABELS[subject]).join(', ')}`}
      data-slot="subject-badges"
    >
      {subjects.map((subject) => (
        <li
          key={subject}
          aria-hidden="true"
          className="rounded-full border-2 border-slate-line bg-paper px-2.5 py-0.5 text-sm font-semibold text-ink"
        >
          {SUBJECT_ICONS[subject]} {SUBJECT_LABELS[subject]}
        </li>
      ))}
    </ul>
  );
}

export function AgeRange({ bands }: { bands: readonly string[] }) {
  const label = ageRangeLabel(bands);
  return label ? <p className="m-0 text-sm font-semibold text-ink-muted">{label}</p> : null;
}

/** The child's picture and nickname for the shell's header. Nothing invented: no XP or level. */
export function ChildBadge({ child }: { child: ChildProfile }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2" data-slot="child-badge">
      <span className="shrink-0 rounded-full border-2 border-treasure-300 bg-paper">
        <ChildAvatar avatarKey={child.avatarKey} photoKey={child.avatarPhotoKey} size="small" />
      </span>
      <span className="truncate font-semibold text-ink">{child.nickname}</span>
    </span>
  );
}
