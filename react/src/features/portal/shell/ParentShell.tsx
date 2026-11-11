import type { ReactNode } from 'react';
import '../portal.css';

interface ParentShellProps {
  /** Left of the top bar, after the brand: e.g. the child switcher. */
  context?: ReactNode;
  /** Right of the top bar: e.g. the account menu. */
  actions?: ReactNode;
  mainClassName?: string;
  children: ReactNode;
}

/**
 * The parent space's shell (AP-01). Deliberately unlike the child shell: a
 * quiet white top bar with an ocean rule, a labelled "Parent space" brand,
 * and no picture navigation, so an adult always knows which side of the
 * island they are on and a child does not mistake it for play.
 */
export function ParentShell({ context, actions, mainClassName, children }: ParentShellProps) {
  return (
    <div className="flex min-h-screen flex-col" data-shell="parent">
      <header className="flex flex-wrap items-center justify-between gap-3 border-t-4 border-b border-t-ocean-700 border-b-slate-line bg-white px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-4">
          <p className="m-0 flex flex-col leading-tight">
            <span className="font-display text-lg font-bold text-ink">
              Learning Adventure Island
            </span>
            <span className="text-sm font-semibold text-ocean-700">Parent space</span>
          </p>
          {context}
        </div>
        {actions}
      </header>
      <main id="main-content" className={mainClassName}>
        {children}
      </main>
    </div>
  );
}
