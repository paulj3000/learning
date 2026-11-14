import { Link } from 'react-router-dom';
import { AuthUnconfiguredHint } from '../features/auth/AuthStatusNotice';
import { AUTH_UNCONFIGURED_COPY } from '../features/auth/authNoticeCopy';
import { isCognitoConfigured } from '../lib/cognito';
import '../features/portal/portal.css';
import { PortalButton, PortalCard } from '../features/portal/ui';

/**
 * What a parent learns from the landing page, from the product pillars in
 * CLAUDE.md section 4. Nothing here promises a feature that is not built.
 */
const PILLARS = [
  {
    icon: '🧭',
    title: 'Adventure first',
    body: 'Children help characters, solve problems and explore, not work through a worksheet.',
    tone: 'tropical',
  },
  {
    icon: '🌱',
    title: 'Learning makes the island grow',
    body: 'Each thing your child learns repairs, unlocks or changes something on the island.',
    tone: 'treasure',
  },
  {
    icon: '🛡️',
    title: 'Parents stay in charge',
    body: 'You create the profiles, choose the settings and see what your child has learned.',
    tone: 'purple',
  },
] as const;

/** The public landing page, drawn with the Adventure Portal theme (AP-01). */
export function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-ocean-50">
      <header className="flex items-center gap-3 border-b-4 border-ocean-900 bg-ocean-700 px-4 py-3 md:px-6">
        <img className="h-10 w-10 rounded-full bg-paper p-1" src="/favicon.svg" alt="" />
        <p className="m-0 font-display text-lg font-bold text-white">Learning Adventure Island</p>
      </header>
      <main
        className="flex flex-1 flex-col items-center gap-10 px-4 py-10 md:py-14"
        id="main-content"
      >
        <section className="flex w-full max-w-5xl flex-col items-center gap-5 rounded-3xl border-b-4 border-ocean-900 bg-ocean-700 px-6 py-10 text-center text-white shadow-sm md:px-12 md:py-14">
          <p className="m-0 text-4xl" aria-hidden="true">
            🏝️
          </p>
          <h1 className="m-0 max-w-3xl font-display text-4xl text-white md:text-5xl">
            An island that grows when your child learns
          </h1>
          <p className="m-0 max-w-2xl text-lg text-white">
            Learning Adventure Island is a guided, AI-powered adventure world for children ages 3 to
            8. Create a parent account to set up child profiles and get started.
          </p>
          {isCognitoConfigured ? (
            <div className="flex flex-wrap justify-center gap-3">
              <PortalButton asChild tone="treasure" size="lg">
                <Link to="/sign-up">Create a parent account</Link>
              </PortalButton>
              <PortalButton asChild tone="quiet" size="lg">
                <Link to="/sign-in">Sign in</Link>
              </PortalButton>
            </div>
          ) : (
            <div className="m-0 flex max-w-xl flex-col gap-2 rounded-2xl bg-treasure-50 px-4 py-3 text-ink">
              <p className="m-0 font-semibold">{AUTH_UNCONFIGURED_COPY.heading}</p>
              <p className="m-0">{AUTH_UNCONFIGURED_COPY.lead}</p>
              <AuthUnconfiguredHint className="m-0 text-sm" />
            </div>
          )}
        </section>
        <ul className="m-0 grid w-full max-w-5xl list-none gap-4 p-0 md:grid-cols-3">
          {PILLARS.map((pillar) => (
            <li key={pillar.title} className="flex">
              <PortalCard tone={pillar.tone} as="article" className="flex-1">
                <span className="text-3xl" aria-hidden="true">
                  {pillar.icon}
                </span>
                <h2 className="m-0 font-display text-xl text-ink">{pillar.title}</h2>
                <p className="m-0">{pillar.body}</p>
              </PortalCard>
            </li>
          ))}
        </ul>
      </main>
      <footer className="border-t-2 border-ocean-100 bg-paper px-4 py-4 text-center text-sm text-ink-muted">
        <p className="m-0">Learning Adventure Island</p>
      </footer>
    </div>
  );
}
