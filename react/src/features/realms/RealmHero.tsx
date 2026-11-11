import type { ReactNode } from 'react';

/**
 * The Realm Explorer's welcome (AP-03): an ocean banner with a drawn archipelago and compass.
 * The artwork sits in its own column (below the words on a phone), never under the text, so
 * the white-on-ocean contrast always holds. Nothing moves.
 */
export function RealmHero({ children }: { children?: ReactNode }) {
  return (
    <section
      aria-labelledby="realm-explorer-heading"
      data-portal="realm-hero"
      className="grid w-full gap-4 overflow-hidden rounded-3xl border-b-4 border-ocean-900 bg-ocean-700 p-6 text-white shadow-sm md:grid-cols-[1fr_auto] md:items-center md:p-8"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <p className="m-0 text-lg font-semibold text-white">Learning Adventure Island</p>
        <h1
          id="realm-explorer-heading"
          className="m-0 font-display text-4xl leading-tight text-white md:text-5xl"
        >
          Realm Explorer
        </h1>
        <p className="m-0 max-w-xl text-lg text-white md:text-xl">
          Choose a Realm to learn, play, and go on an adventure!
        </p>
        {children}
      </div>
      <ArchipelagoArt />
    </section>
  );
}

function ArchipelagoArt() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 260 170"
      className="h-28 w-full max-w-xs justify-self-center md:h-44 md:w-64"
    >
      <ellipse cx="130" cy="150" rx="128" ry="18" fill="#1a8fc7" />
      <path d="M20 148 C 40 120, 80 118, 100 148 Z" fill="#2e9b52" />
      <path d="M150 148 C 170 104, 230 104, 248 148 Z" fill="#1b6b37" />
      <path d="M104 152 C 112 140, 130 140, 138 152 Z" fill="#f7e9db" />
      <path d="M58 126 C 60 112, 64 102, 62 92" stroke="#6b4e00" strokeWidth="3" fill="none" />
      <path d="M62 92 C 50 88, 42 94, 38 102 C 48 96, 56 96, 62 92 Z" fill="#c9ecd5" />
      <path d="M62 92 C 74 86, 84 92, 86 100 C 76 94, 70 94, 62 92 Z" fill="#c9ecd5" />
      <path d="M200 112 l 0 -30 l 16 24 z" fill="#fefdfb" />
      <path d="M188 112 l 34 0 l -6 8 l -22 0 z" fill="#6b4e00" />
      <g transform="translate(128 58)">
        <circle r="40" fill="#fefdfb" stroke="#ffd75e" strokeWidth="6" />
        <circle r="30" fill="none" stroke="#cce9f6" strokeWidth="2" />
        <path d="M0 -30 L 8 0 L 0 30 L -8 0 Z" fill="#0b5a85" />
        <path d="M0 -30 L 8 0 L -8 0 Z" fill="#ff6f61" />
        <path d="M-30 0 L 0 -6 L 30 0 L 0 6 Z" fill="#6cc3e8" opacity="0.8" />
        <circle r="4" fill="#ffd75e" />
      </g>
    </svg>
  );
}
