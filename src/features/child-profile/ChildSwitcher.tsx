import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './ChildSwitcher.module.css';
import { ChildAvatar } from './ChildAvatar';
import { AGE_BAND_LABELS, MAX_CHILD_PROFILES } from './constants';
import type { ChildProfile } from './api';

interface ChildSwitcherProps {
  childProfiles: ChildProfile[];
  selectedChildId: string | null;
  onSelect: (childId: string) => void;
}

/**
 * Header control for choosing which child the parent dashboard is showing,
 * replacing the card list that used to occupy the whole page. It follows the
 * same dropdown pattern as `UserMenu` beside it (outside click and Escape
 * close it) so the header has one predictable interaction, per CLAUDE.md
 * pillar 7's "calm engagement".
 *
 * Deliberately a menu of buttons rather than a `<select>`: each row carries an
 * avatar and an age band, and the menu also ends with the "Add child" link
 * that a `<select>` has nowhere to put. `menuitemradio` is the matching role
 * for "exactly one of these is current".
 *
 * This is a parent-facing control on a parent-authenticated page, not a child
 * sign-in: picking a child here only changes what this dashboard displays.
 */
export function ChildSwitcher({ childProfiles, selectedChildId, onSelect }: ChildSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectedChild = childProfiles.find((child) => child.id === selectedChildId) ?? null;
  const canAddChild = childProfiles.length < MAX_CHILD_PROFILES;

  if (childProfiles.length === 0) {
    return (
      <Link className={styles.addFirstLink} to="/home/children/new">
        Add your first child
      </Link>
    );
  }

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        className={styles.trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose a child"
        onClick={() => setOpen((current) => !current)}
      >
        {selectedChild ? (
          /* Decorative: the nickname beside it is the accessible name. */
          <ChildAvatar
            avatarKey={selectedChild.avatarKey}
            photoKey={selectedChild.avatarPhotoKey}
            size="small"
          />
        ) : null}
        <span className={styles.triggerName}>{selectedChild?.nickname ?? 'Choose a child'}</span>
        <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M7 10l5 5 5-5H7Z" />
        </svg>
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          {childProfiles.map((child) => (
            <button
              className={styles.menuItemButton}
              key={child.id}
              role="menuitemradio"
              aria-checked={child.id === selectedChildId}
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect(child.id);
              }}
            >
              {/* Decorative: the nickname beside it is the accessible name. */}
              <ChildAvatar
                avatarKey={child.avatarKey}
                photoKey={child.avatarPhotoKey}
                size="small"
              />
              <span>
                <span className={styles.menuName}>{child.nickname}</span>
                <span className={styles.menuMeta}>
                  {AGE_BAND_LABELS[child.ageBand]}
                  {child.active ? '' : ' · Deactivated'}
                </span>
              </span>
            </button>
          ))}
          {canAddChild ? (
            <Link
              className={styles.menuItem}
              role="menuitem"
              to="/home/children/new"
              onClick={() => setOpen(false)}
            >
              Add child
            </Link>
          ) : (
            <p className={styles.menuHint}>
              You have reached the limit of {MAX_CHILD_PROFILES} child profiles.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
