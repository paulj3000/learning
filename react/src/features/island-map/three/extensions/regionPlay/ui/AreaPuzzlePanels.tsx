import { useState } from 'react';
import type { InventoryEntry } from '../../../../../../api/play/types';
import { AREA_COPY, journalEntries, readableDate } from '../../../../../region-play/areaPuzzleUi';
import {
  dueHint,
  type CollectParams,
  type ObserveParams,
  type PlatformParams,
  type ValveParams,
} from '../../../../../region-play/areaPuzzles';
import { GameDialog } from './GameDialog';
import styles from './RegionPlayPanels.module.css';
import area from './AreaPuzzlePanels.module.css';

/**
 * The React panels for 3D Area puzzles (ADR-043 F, Firepeak FP-5 to FP-10). Every one is a plain
 * set of large buttons, so a child can do the whole puzzle by keyboard, touch or switch access as
 * well as in the 3D scene. Text comes from Django content (the puzzle's band parameters); these
 * components add only interface words. Nothing here grades: `onSubmit` sends the child's answer
 * to the server, and what comes back decides what is shown.
 */

function Hint({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className={styles.hints} role="note">
      <strong>{AREA_COPY.hint}: </strong>
      {text}
    </p>
  );
}

/** Feedback and an optional hint: hints are always offered, and after a few tries shown. */
function Feedback({
  wrong,
  wrongText,
  hints,
  due,
}: {
  wrong: boolean;
  wrongText: string;
  hints: readonly string[];
  due: string | null;
}) {
  const [asked, setAsked] = useState(false);
  const shown = due ?? (asked ? (hints[0] ?? null) : null);
  return (
    <>
      {wrong ? (
        <p className={styles.feedbackWrong} role="status">
          {wrongText}
        </p>
      ) : null}
      <Hint text={shown} />
      {!shown && hints.length > 0 ? (
        <button type="button" className={styles.button} onClick={() => setAsked(true)}>
          {AREA_COPY.needHint}
        </button>
      ) : null}
    </>
  );
}

// --- Telescope (OBSERVE_FEATURES) -------------------------------------------------------------

/** Where each known feature sits in the telescope picture (percent); others fall in a row. */
const HOTSPOTS: Record<string, { left: number; top: number }> = {
  crater: { left: 50, top: 14 },
  'lava-flow': { left: 36, top: 52 },
  'steam-vent': { left: 70, top: 34 },
};

export interface TelescopePanelProps {
  title: string;
  params: ObserveParams;
  observed: readonly string[];
  failedAttempts: number;
  wrong: boolean;
  busy: boolean;
  onObserve(featureId: string): void;
  onSubmit(): void;
  onClose(): void;
}

export function TelescopePanel(props: TelescopePanelProps) {
  const { params, observed } = props;
  const [focused, setFocused] = useState<string | null>(null);
  const seen = new Set(observed);
  const allSeen = params.features.every((feature) => seen.has(feature.id));
  const current = params.features.find((feature) => feature.id === focused);
  return (
    <GameDialog titleId="area-telescope-title" title={props.title} onClose={props.onClose}>
      <p className={styles.speech}>{params.intro}</p>
      <div className={area.telescopeView} role="group" aria-label={props.title}>
        <svg viewBox="0 0 100 70" className={area.telescopeArt} aria-hidden="true">
          <rect width="100" height="70" fill="#2a1f2e" />
          <polygon points="10,70 46,12 54,12 90,70" fill="#5b4a4a" />
          <ellipse cx="50" cy="12" rx="7" ry="2.5" fill="#ff6a1a" />
          <path d="M48 14 C44 30 38 44 34 70" stroke="#ff7b2a" strokeWidth="3" fill="none" />
          <path
            d="M70 34 q2 -6 0 -12 q-2 -6 1 -10"
            stroke="#e8e8e8"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
        {params.features.map((feature, index) => {
          const spot = HOTSPOTS[feature.id] ?? { left: 15 + index * 20, top: 85 };
          return (
            <button
              key={feature.id}
              type="button"
              className={[area.hotspot, seen.has(feature.id) ? area.hotspotSeen : ''].join(' ')}
              style={{ left: `${spot.left}%`, top: `${spot.top}%` }}
              aria-pressed={seen.has(feature.id)}
              onClick={() => {
                setFocused(feature.id);
                props.onObserve(feature.id);
              }}
            >
              <span>
                {seen.has(feature.id) ? `${feature.label}: ${AREA_COPY.seen}` : feature.label}
              </span>
            </button>
          );
        })}
      </div>
      <p className={styles.speech} aria-live="polite">
        {current ? `${current.label}. ${current.explanation}` : AREA_COPY.keepLooking}
      </p>
      <Feedback
        wrong={props.wrong}
        wrongText={AREA_COPY.notYet}
        hints={params.hints}
        due={dueHint(params, props.failedAttempts)}
      />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={!allSeen || props.busy}
          aria-busy={props.busy}
          onClick={props.onSubmit}
        >
          {props.busy ? AREA_COPY.checking : AREA_COPY.tellProfessor}
        </button>
        <button type="button" className={styles.button} onClick={props.onClose}>
          {AREA_COPY.later}
        </button>
      </div>
    </GameDialog>
  );
}

// --- Lava crossing (PLACE_PLATFORMS) ----------------------------------------------------------

/** A size as squares to see and words to hear. */
function Size({ n }: { n: number }) {
  return (
    <>
      {' '}
      <span aria-hidden="true">{'■'.repeat(n)}</span>
      <span className={styles.visuallyHidden}>{`size ${n}`}</span>
    </>
  );
}

export interface CrossingPanelProps {
  title: string;
  params: PlatformParams;
  placements: Readonly<Record<string, string>>;
  carried: string | null;
  fits: readonly string[];
  failedAttempts: number;
  wrong: boolean;
  busy: boolean;
  onCarry(stoneId: string | null): void;
  onPlace(stoneId: string, slotId: string): void;
  onRemove(stoneId: string): void;
  onSubmit(): void;
  onClose(): void;
}

export function CrossingPanel(props: CrossingPanelProps) {
  const { params, placements, carried } = props;
  const stoneLabel = (id: string) => params.stones.find((stone) => stone.id === id)?.label ?? id;
  const filled = params.slots.every((slot) => placements[slot.id]);
  const placedStones = new Set(Object.values(placements));
  return (
    <GameDialog titleId="area-crossing-title" title={props.title} onClose={props.onClose}>
      <p className={styles.speech}>{params.intro}</p>
      <p className={styles.speech} aria-live="polite">
        {carried ? `${AREA_COPY.carrying}: ${stoneLabel(carried)}` : null}
      </p>
      <ul className={styles.list} aria-label={props.title}>
        {params.slots.map((slot) => {
          const stone = placements[slot.id];
          const fits = props.fits.includes(slot.id);
          return (
            <li key={slot.id} className={styles.listItem}>
              <span>
                {slot.label}
                <Size n={slot.gap} />: {stone ? stoneLabel(stone) : AREA_COPY.emptyGap}
                {stone && fits ? ` ${AREA_COPY.fitsGlow}` : ''}
              </span>
              {carried ? (
                <button
                  type="button"
                  className={styles.choice}
                  onClick={() => props.onPlace(carried, slot.id)}
                >
                  {AREA_COPY.putIn}
                </button>
              ) : stone ? (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => props.onRemove(stone)}
                >
                  {AREA_COPY.takeOut}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className={styles.choices} role="group" aria-label={AREA_COPY.pickUp}>
        {params.stones
          .filter((stone) => !placedStones.has(stone.id))
          .map((stone) => (
            <button
              key={stone.id}
              type="button"
              className={styles.choice}
              aria-pressed={carried === stone.id}
              onClick={() => props.onCarry(carried === stone.id ? null : stone.id)}
            >
              {`${AREA_COPY.pickUp}: ${stone.label}`}
              <Size n={stone.size} />
            </button>
          ))}
      </div>
      <Feedback
        wrong={props.wrong}
        wrongText={AREA_COPY.crossingWrong}
        hints={params.hints}
        due={dueHint(params, props.failedAttempts)}
      />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={!filled || props.busy}
          aria-busy={props.busy}
          onClick={props.onSubmit}
        >
          {props.busy ? AREA_COPY.checking : AREA_COPY.checkCrossing}
        </button>
        <button type="button" className={styles.button} onClick={props.onClose}>
          {AREA_COPY.later}
        </button>
      </div>
    </GameDialog>
  );
}

// --- Steam valves (VALVE_SEQUENCE) ------------------------------------------------------------

export interface ValvePanelProps {
  title: string;
  params: ValveParams;
  sequence: readonly string[];
  steamAt: string;
  lastTurnMoved: boolean | null;
  failedAttempts: number;
  wrong: boolean;
  busy: boolean;
  onTurn(valveId: string): void;
  onReset(): void;
  onClose(): void;
}

export function ValvePanel(props: ValvePanelProps) {
  const { params, steamAt } = props;
  const channel = (id: string) => params.channels.find((c) => c.id === id)?.label ?? id;
  const turned = new Set(props.sequence);
  return (
    <GameDialog titleId="area-valves-title" title={props.title} onClose={props.onClose}>
      <p className={styles.speech}>{params.intro}</p>
      <ol className={area.channels} aria-label={`${AREA_COPY.steamIsIn} ${channel(steamAt)}`}>
        {params.channels.map((c) => (
          <li
            key={c.id}
            className={[
              area.channel,
              c.id === steamAt ? area.channelSteam : '',
              c.id === params.goal ? area.channelGoal : '',
            ].join(' ')}
          >
            {c.label}
            {c.id === steamAt ? ' ☁' : ''}
          </li>
        ))}
      </ol>
      <p className={styles.speech} aria-live="polite">
        {`${AREA_COPY.steamIsIn} ${channel(steamAt)}.`}
        {props.lastTurnMoved === false ? ` ${AREA_COPY.nothingHappened}` : ''}
      </p>
      <div className={styles.choices} role="group" aria-label={props.title}>
        {params.valves.map((valve) => (
          <button
            key={valve.id}
            type="button"
            className={styles.choice}
            disabled={props.busy}
            aria-pressed={turned.has(valve.id)}
            onClick={() => props.onTurn(valve.id)}
          >
            {`${turned.has(valve.id) ? AREA_COPY.turned : AREA_COPY.turn}: ${valve.label}`}
            {params.showSteamPath ? ` (${channel(valve.from)} to ${channel(valve.to)})` : ''}
          </button>
        ))}
      </div>
      <Feedback
        wrong={props.wrong}
        wrongText={AREA_COPY.notYet}
        hints={params.hints}
        due={dueHint(params, props.failedAttempts)}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={props.onReset}>
          {AREA_COPY.resetValves}
        </button>
        <button type="button" className={styles.button} onClick={props.onClose}>
          {AREA_COPY.later}
        </button>
      </div>
    </GameDialog>
  );
}

// --- Discovery (COLLECT_OBJECT) ---------------------------------------------------------------

export interface DiscoveryPanelProps {
  title: string;
  params: CollectParams;
  phase: 'ready' | 'discovering' | 'found';
  busy: boolean;
  onCollect(): void;
  onClose(): void;
}

export function DiscoveryPanel(props: DiscoveryPanelProps) {
  const { params, phase } = props;
  return (
    <GameDialog titleId="area-discovery-title" title={props.title} onClose={props.onClose}>
      {phase === 'found' ? (
        <div className={styles.reward} role="status">
          <p className={styles.questDone}>{params.discoveryMessage}</p>
          {params.scienceNote ? <p className={styles.speech}>{params.scienceNote}</p> : null}
          {params.completeMessage ? (
            <p className={styles.speech}>{params.completeMessage}</p>
          ) : null}
        </div>
      ) : (
        <p className={styles.speech}>{params.intro}</p>
      )}
      <div className={styles.actions}>
        {phase === 'ready' ? (
          <button
            type="button"
            className={styles.primary}
            disabled={props.busy}
            aria-busy={props.busy}
            onClick={props.onCollect}
          >
            {AREA_COPY.pickCrystal}
          </button>
        ) : null}
        <button type="button" className={styles.button} onClick={props.onClose}>
          {AREA_COPY.close}
        </button>
      </div>
    </GameDialog>
  );
}

// --- Discovery Journal (FP-10) -----------------------------------------------------------------

export function JournalList({ inventory }: { inventory: readonly InventoryEntry[] }) {
  const entries = journalEntries(inventory);
  return (
    <>
      <h3 className={styles.speech}>{AREA_COPY.journalTitle}</h3>
      {entries.length === 0 ? (
        <p className={styles.speech}>{AREA_COPY.journalEmpty}</p>
      ) : (
        <ul className={styles.list} aria-label={AREA_COPY.journalTitle}>
          {entries.map((entry) => (
            <li key={entry.itemId} className={area.journalEntry}>
              <strong>{entry.title}</strong>
              <span>{entry.description}</span>
              <span className={styles.status}>
                {`${entry.subject}. ${AREA_COPY.discoveredOn} ${readableDate(entry.discoveredAt)}.`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
