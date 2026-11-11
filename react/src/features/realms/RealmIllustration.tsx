import { useId, type ReactElement } from 'react';
import type { RealmScene } from './realmThemes';

/**
 * Drawn fallback pictures for Realms and Places (AP-03): small inline SVGs, so a card always
 * has a picture without a download, an external image or a broken-image icon. Colours are the
 * Adventure Portal palette (portal.css, ADR-052), written as hexes because SVG fills cannot use
 * the portal's utilities.
 */
const C = {
  ocean50: '#eaf6fc',
  ocean100: '#cce9f6',
  ocean300: '#6cc3e8',
  ocean500: '#1a8fc7',
  ocean700: '#0b5a85',
  ocean900: '#06344f',
  tropical100: '#c9ecd5',
  tropical500: '#2e9b52',
  tropical700: '#1b6b37',
  treasure100: '#ffefb0',
  treasure300: '#ffd75e',
  treasure500: '#f2b705',
  treasure800: '#6b4e00',
  coral100: '#ffd3ce',
  coral500: '#ff6f61',
  coral700: '#b3362b',
  purple100: '#e1d8fb',
  purple500: '#8a6be0',
  purple700: '#5b3bb0',
  sand: '#f7e9db',
  paper: '#fefdfb',
  stone: '#4d4c4b',
  ink: '#1a1e26',
} as const;

interface Palette {
  skyTop: string;
  skyBottom: string;
  sea: string;
  seaDeep: string;
}

const SKIES: Record<RealmScene, Palette> = {
  island: { skyTop: C.ocean300, skyBottom: C.ocean50, sea: C.ocean500, seaDeep: C.ocean700 },
  cove: { skyTop: C.ocean100, skyBottom: C.paper, sea: C.ocean300, seaDeep: C.ocean500 },
  treasure: {
    skyTop: C.treasure300,
    skyBottom: C.treasure100,
    sea: C.ocean500,
    seaDeep: C.ocean700,
  },
  castle: { skyTop: C.purple500, skyBottom: C.purple100, sea: C.purple700, seaDeep: C.ocean900 },
  volcano: { skyTop: C.coral500, skyBottom: C.treasure100, sea: C.ocean700, seaDeep: C.ocean900 },
  forest: { skyTop: C.tropical100, skyBottom: C.paper, sea: C.ocean300, seaDeep: C.ocean500 },
  harbor: { skyTop: C.ocean100, skyBottom: C.treasure100, sea: C.ocean500, seaDeep: C.ocean900 },
};

function Palm({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M0 0 C 2 -18, 6 -32, 4 -46" stroke={C.treasure800} strokeWidth="4" fill="none" />
      <path
        d="M4 -46 C -10 -52, -22 -46, -28 -36 C -16 -42, -6 -42, 4 -46 Z"
        fill={C.tropical500}
      />
      <path d="M4 -46 C 18 -54, 30 -48, 34 -38 C 22 -44, 12 -44, 4 -46 Z" fill={C.tropical700} />
      <path d="M4 -46 C 0 -62, 10 -70, 20 -70 C 12 -62, 8 -54, 4 -46 Z" fill={C.tropical500} />
    </g>
  );
}

function Tree({ x, y, scale = 1, fill }: { x: number; y: number; scale?: number; fill: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x="-3" y="-12" width="6" height="14" fill={C.treasure800} />
      <path d="M0 -58 L 20 -12 L -20 -12 Z" fill={fill} />
      <path d="M0 -70 L 15 -36 L -15 -36 Z" fill={fill} />
    </g>
  );
}

const SCENES: Record<RealmScene, () => ReactElement> = {
  island: () => (
    <>
      <circle cx="262" cy="46" r="22" fill={C.treasure300} />
      <path d="M40 150 C 80 104, 170 98, 230 150 Z" fill={C.tropical500} />
      <path d="M70 150 C 100 128, 180 124, 210 150 Z" fill={C.sand} />
      <Palm x={120} y={132} />
      <Palm x={168} y={136} scale={0.8} />
      <path d="M232 132 l 30 0 l -6 10 l -20 0 z" fill={C.treasure800} />
      <path d="M246 132 l 0 -26 l 14 22 z" fill={C.paper} />
    </>
  ),
  cove: () => (
    <>
      <path d="M0 140 C 40 96, 90 100, 120 150 L 0 150 Z" fill={C.tropical700} />
      <path d="M320 140 C 280 92, 230 100, 200 150 L 320 150 Z" fill={C.tropical500} />
      <ellipse cx="160" cy="166" rx="34" ry="12" fill={C.tropical500} />
      <ellipse cx="160" cy="160" rx="22" ry="10" fill={C.tropical700} />
      <circle cx="186" cy="158" r="6" fill={C.tropical500} />
      <path d="M90 180 l 8 -12 l 8 12 z" fill={C.coral500} />
      <path d="M220 184 c 4 -10, 14 -10, 18 0 z" fill={C.treasure300} />
    </>
  ),
  treasure: () => (
    <>
      <path d="M180 150 C 210 112, 280 110, 320 136 L 320 150 Z" fill={C.tropical500} />
      <Palm x={258} y={130} />
      <path d="M40 140 l 110 0 l -14 22 l -82 0 z" fill={C.treasure800} />
      <rect x="92" y="62" width="5" height="78" fill={C.treasure800} />
      <path d="M97 66 l 46 30 l -46 20 z" fill={C.paper} />
      <path d="M92 66 l -40 30 l 40 14 z" fill={C.sand} />
      <path d="M94 56 l 18 6 l -18 6 z" fill={C.ink} />
      <rect x="206" y="160" width="40" height="24" rx="4" fill={C.treasure500} />
      <path d="M206 164 a 20 12 0 0 1 40 0 z" fill={C.treasure800} />
      <circle cx="226" cy="170" r="4" fill={C.treasure300} />
    </>
  ),
  castle: () => (
    <>
      <circle cx="58" cy="40" r="14" fill={C.paper} />
      <circle cx="64" cy="36" r="13" fill={C.purple500} />
      <path d="M40 150 C 90 120, 230 120, 280 150 Z" fill={C.purple700} />
      <rect x="110" y="70" width="100" height="70" fill={C.purple100} />
      <rect x="96" y="50" width="28" height="90" fill={C.paper} />
      <rect x="196" y="50" width="28" height="90" fill={C.paper} />
      <path d="M92 52 l 18 -28 l 18 28 z" fill={C.purple500} />
      <path d="M192 52 l 18 -28 l 18 28 z" fill={C.purple500} />
      <path d="M146 140 l 0 -26 a 14 14 0 0 1 28 0 l 0 26 z" fill={C.treasure800} />
      <rect x="106" y="74" width="8" height="12" fill={C.treasure300} />
      <rect x="206" y="74" width="8" height="12" fill={C.treasure300} />
      <path d="M236 168 l 24 -6 l 24 6 l 0 16 l -24 -6 l -24 6 z" fill={C.treasure300} />
      <path d="M260 162 l 0 16" stroke={C.treasure800} strokeWidth="2" />
    </>
  ),
  volcano: () => (
    <>
      <path d="M0 150 L 70 96 L 120 150 Z" fill={C.stone} />
      <path d="M90 150 L 160 44 L 186 44 L 262 150 Z" fill={C.ink} />
      <path d="M160 44 L 186 44 L 196 62 C 182 70, 166 70, 152 62 Z" fill={C.coral700} />
      <path d="M168 62 C 164 84, 178 96, 170 118 C 184 98, 176 82, 180 62 Z" fill={C.coral500} />
      <path
        d="M150 34 C 140 20, 160 12, 156 0"
        stroke={C.paper}
        strokeWidth="6"
        fill="none"
        opacity="0.8"
      />
      <path
        d="M190 30 C 200 18, 186 8, 196 -4"
        stroke={C.paper}
        strokeWidth="5"
        fill="none"
        opacity="0.7"
      />
      <circle cx="220" cy="20" r="4" fill={C.treasure300} />
      <circle cx="136" cy="26" r="3" fill={C.treasure500} />
    </>
  ),
  forest: () => (
    <>
      <path d="M0 150 C 60 116, 260 112, 320 150 Z" fill={C.tropical500} />
      <Tree x={70} y={146} fill={C.tropical700} />
      <Tree x={120} y={140} scale={1.2} fill={C.tropical500} />
      <Tree x={200} y={142} scale={1.1} fill={C.tropical700} />
      <Tree x={254} y={148} fill={C.tropical500} />
      <circle cx="160" cy="70" r="5" fill={C.treasure300} />
      <circle cx="180" cy="58" r="3" fill={C.treasure300} />
      <circle cx="146" cy="52" r="4" fill={C.treasure300} />
    </>
  ),
  harbor: () => (
    <>
      <path d="M0 150 L 120 150 L 120 128 L 0 128 Z" fill={C.stone} />
      <rect x="60" y="56" width="22" height="72" fill={C.paper} />
      <rect x="60" y="76" width="22" height="10" fill={C.coral700} />
      <rect x="60" y="100" width="22" height="10" fill={C.coral700} />
      <path d="M56 56 l 30 0 l -15 -18 z" fill={C.ocean900} />
      <circle cx="71" cy="64" r="5" fill={C.treasure300} />
      <g transform="translate(232 92)">
        <circle r="26" fill={C.treasure500} />
        <circle r="10" fill={C.treasure100} />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <rect
            key={angle}
            x="-5"
            y="-34"
            width="10"
            height="12"
            fill={C.treasure500}
            transform={`rotate(${angle})`}
          />
        ))}
      </g>
      <path d="M170 150 l 60 0 l -8 12 l -44 0 z" fill={C.treasure800} />
    </>
  ),
};

interface RealmIllustrationProps {
  scene: RealmScene;
  /** Read aloud; empty when the picture is decorative next to its own title. */
  label: string;
  className?: string;
}

export function RealmIllustration({ scene, label, className }: RealmIllustrationProps) {
  const gradientId = `realm-sky-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const sky = SKIES[scene];
  const Scene = SCENES[scene];
  return (
    <svg
      className={className}
      viewBox="0 0 320 200"
      preserveAspectRatio="xMidYMid slice"
      data-scene={scene}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky.skyTop} />
          <stop offset="1" stopColor={sky.skyBottom} />
        </linearGradient>
      </defs>
      <rect width="320" height="200" fill={`url(#${gradientId})`} />
      <rect y="150" width="320" height="50" fill={sky.sea} />
      <path
        d="M0 168 C 40 160, 80 176, 120 168 S 200 160, 240 168 S 300 176, 320 168 L 320 200 L 0 200 Z"
        fill={sky.seaDeep}
        opacity="0.6"
      />
      <Scene />
    </svg>
  );
}
