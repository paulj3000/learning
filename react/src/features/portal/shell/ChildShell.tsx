import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import '../portal.css';
import { cn } from '../ui/cn';
import { portalPath, type PortalDestination } from '../exit/adventureRoutes';

export interface ChildNavItem {
  label: string;
  /** Decorative picture for pre-readers; hidden from assistive technology. */
  icon: string;
  destination: PortalDestination;
}

/** The child's navigation, in reading order. Labels are short enough for a phone's bottom bar. */
export const CHILD_NAV_ITEMS: readonly ChildNavItem[] = [
  { label: 'Island Explorer', icon: '🧭', destination: { kind: 'island-explorer' } },
  { label: 'Sailing dock', icon: '⛵', destination: { kind: 'sailing-dock' } },
  { label: 'Adventure log', icon: '📖', destination: { kind: 'adventure-log' } },
  { label: 'Quest journal', icon: '🗺️', destination: { kind: 'quest-journal' } },
  { label: 'Library', icon: '📚', destination: { kind: 'library' } },
];

interface ChildShellProps {
  childId: string;
  /** The top bar's right-hand controls: "Leave island" and the adult exit. */
  actions?: ReactNode;
  /** Classes for `<main>`, so existing pages keep their own layout. */
  mainClassName?: string;
  children: ReactNode;
  /** Rendered after `<main>`: overlays such as the calm stop. */
  overlays?: ReactNode;
}

/**
 * The child-mode shell (AP-01).
 *
 * One `<nav>` that is a bottom bar on phones and a left sidebar from `md`
 * (tablet landscape) up, restyled by breakpoint rather than rendered twice,
 * so every link exists exactly once for keyboards and screen readers. Each
 * item is a real link with a 56px-tall target, a picture for pre-readers and
 * a visible word; the current page gets `aria-current="page"` from `NavLink`.
 *
 * The exits live in the top bar at every size, never in the bottom bar,
 * so they cannot be mistaken for navigation and are always within reach.
 */
export function ChildShell({
  childId,
  actions,
  mainClassName,
  children,
  overlays,
}: ChildShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-sand pb-20 md:pb-0 md:pl-56" data-shell="child">
      <nav
        aria-label="Island"
        className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-ocean-100 bg-paper md:inset-y-0 md:right-auto md:left-0 md:w-56 md:border-t-0 md:border-r-2"
      >
        <p className="m-0 hidden px-5 pt-6 pb-4 font-display text-lg font-bold text-ocean-900 md:block">
          Adventure Island
        </p>
        <ul className="m-0 flex list-none justify-around p-0 md:flex-col md:justify-start md:gap-1 md:px-3">
          {CHILD_NAV_ITEMS.map((item) => (
            <li key={item.label} className="flex-1 md:flex-none">
              <NavLink
                to={portalPath(childId, item.destination)}
                end
                className={({ isActive }) =>
                  cn(
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1 text-center text-xs font-semibold text-ink no-underline md:flex-row md:justify-start md:gap-3 md:px-3 md:text-left md:text-base',
                    isActive ? 'bg-ocean-100 text-ocean-900' : 'hover:bg-ocean-50',
                  )
                }
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <header className="flex flex-wrap items-center justify-end gap-3 border-b-2 border-ocean-100 bg-paper px-4 py-3 md:px-6">
        {actions}
      </header>
      <main id="main-content" className={mainClassName}>
        {children}
      </main>
      {overlays}
    </div>
  );
}
