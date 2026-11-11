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
  /** Also current on pages below this one (a Realm's preview under Realms). */
  matchDescendants?: boolean;
}

/**
 * The child's navigation, in reading order (AP-03): Home, Realms, Quests and Treasures. Labels
 * are short enough for a 320px phone's bottom bar. Treasures opens the adventure log, where
 * finished missions and creations are kept. The library and the sailing dock stay reachable from
 * Home and the Realm pages.
 */
export const CHILD_NAV_ITEMS: readonly ChildNavItem[] = [
  { label: 'Home', icon: '🏠', destination: { kind: 'island-explorer' } },
  {
    label: 'Realms',
    icon: '🧭',
    destination: { kind: 'realm-explorer' },
    matchDescendants: true,
  },
  { label: 'Quests', icon: '🗺️', destination: { kind: 'quest-journal' } },
  { label: 'Treasures', icon: '💎', destination: { kind: 'adventure-log' } },
];

interface ChildShellProps {
  childId: string;
  /** The top bar's right-hand controls: "Leave island" and the adult exit. */
  actions?: ReactNode;
  /** The child's picture and nickname, when the page has loaded them (AP-03). */
  profile?: ReactNode;
  /** Classes for `<main>`, so existing pages keep their own layout. */
  mainClassName?: string;
  children: ReactNode;
  /** Rendered after `<main>`: overlays. */
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
  profile,
  mainClassName,
  children,
  overlays,
}: ChildShellProps) {
  return (
    <div
      className="flex min-h-screen flex-col bg-ocean-50 pb-20 md:pb-0 md:pl-56"
      data-shell="child"
    >
      <nav
        aria-label="Island"
        className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-ocean-100 bg-paper md:inset-y-0 md:right-auto md:left-0 md:w-56 md:border-t-0 md:border-r-2"
      >
        {/*
          `max-md:hidden`, not `hidden md:block`: admin.css loads after this sheet
          and its own `.hidden` would win, hiding the brand at every size.
        */}
        <p className="m-0 px-5 pt-6 pb-4 font-display text-lg font-bold text-ocean-900 max-md:hidden">
          Learning Adventure Island
        </p>
        <ul className="m-0 flex list-none justify-around p-0 md:flex-col md:justify-start md:gap-1 md:px-3">
          {CHILD_NAV_ITEMS.map((item) => (
            <li key={item.label} className="flex-1 md:flex-none">
              <NavLink
                to={portalPath(childId, item.destination)}
                end={!item.matchDescendants}
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
      <header className="flex flex-wrap items-center gap-3 border-b-2 border-ocean-100 bg-paper px-4 py-3 md:px-6">
        <div className="flex min-w-0 flex-[1_1_14rem] flex-wrap items-center gap-3">
          <p className="m-0 font-display text-base font-bold text-ocean-900 md:hidden">
            <span aria-hidden="true">🏝️ </span>Learning Adventure Island
          </p>
          {profile}
        </div>
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      </header>
      <main id="main-content" className={mainClassName}>
        {children}
      </main>
      {overlays}
    </div>
  );
}
