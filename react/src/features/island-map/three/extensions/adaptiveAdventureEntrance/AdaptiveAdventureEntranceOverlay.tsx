import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from '../../../IslandWorldView.module.css';
import { listAllWorldChanges, resumeOrStartSession } from '../../../../adventures/api';
import { getAdventureTemplate } from '../../../../adventures/content';
import { adventureStartErrorMessage } from '../../../../catalog/availabilityApi';
import {
  resolveAdventureForSkillLevel,
  selectDifficultyLevel,
} from '../../../../adaptive/selection';
import { computeLearningProfile, domainProfile } from '../../../../learning-profile/profile';
import { LEARNING_DOMAINS, type LearningDomain } from '../../../../learning-profile/types';
import { listSkillProgress } from '../../../../mastery/api';
import type { LocationViewExtensionOverlayProps } from '../../runtime/viewExtensionRegistry';
import { tryParseAdaptiveEntranceConfig } from './adaptiveAdventureEntranceConfig';

/**
 * The React half of `adaptive-adventure-entrance` (engine Phase 9). One spot
 * in the world that opens whichever authored variant this child's
 * demonstrated skill is ready for, rather than the one their birthday
 * implies - Clockwork Harbor's lighthouse machine, and reusable by any
 * levelled entrance after it.
 *
 * The selection is the existing Adaptive engine's, in three pure steps and
 * no more: aggregate the evidence the island already records into a Learning
 * Profile, ask what difficulty that domain is ready for, then pick the
 * authored variant nearest that level. Nothing here decides whether an
 * answer is right, which stays with the Adventure Engine, and nothing here
 * writes progress.
 *
 * Moved from `ClockworkHarborWorldView.tsx`, which did the same three steps
 * up front for one hard-coded machine.
 */
type State =
  | { kind: 'thinking' }
  | { kind: 'message'; text: string }
  | { kind: 'ready'; slug: string }
  | { kind: 'error'; text: string };

function isLearningDomain(value: string): value is LearningDomain {
  return (LEARNING_DOMAINS as readonly string[]).includes(value);
}

export function AdaptiveAdventureEntranceOverlay({
  childId,
  ageBand,
  config,
  onClose,
}: LocationViewExtensionOverlayProps) {
  const parsed = tryParseAdaptiveEntranceConfig(config);
  const [state, setState] = useState<State>({ kind: 'thinking' });
  const [starting, setStarting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!parsed) return;
    let cancelled = false;
    async function choose() {
      if (!parsed) return;
      try {
        const [changes, skillProgress] = await Promise.all([
          listAllWorldChanges(childId),
          listSkillProgress(childId),
        ]);
        if (cancelled) return;
        if (changes.some((change) => change.changeKey === parsed.completedChangeKey)) {
          setState({ kind: 'message', text: parsed.completedMessage });
          return;
        }
        const profile = computeLearningProfile(
          skillProgress.map((row) => ({
            skillId: row.learningObjectiveCode,
            counts: {
              exposureCount: row.exposureCount,
              independentSuccessCount: row.independentSuccessCount,
              supportedSuccessCount: row.supportedSuccessCount,
              consecutiveIndependentCorrect: row.consecutiveIndependentCorrect,
              lastPracticedAt: row.lastPracticedAt,
            },
          })),
        );
        const domain = isLearningDomain(parsed.domain) ? parsed.domain : undefined;
        const level = domain ? selectDifficultyLevel(domainProfile(profile, domain)) : 1;
        const candidates = parsed.variantSlugs
          .flatMap((slug) => {
            const template = getAdventureTemplate(slug);
            return template ? [template] : [];
          })
          .filter((template) => template.ageBands.includes(ageBand));
        const chosen = resolveAdventureForSkillLevel(candidates, level);
        if (cancelled) return;
        /*
          No variant for this band is the honest "not yet" rather than a
          crash: a content edit that unlevelled every variant should degrade
          to the authored line, as the per-region view's null guard did.
        */
        setState(
          chosen
            ? { kind: 'ready', slug: chosen.slug }
            : { kind: 'message', text: parsed.unavailableMessage },
        );
      } catch {
        if (!cancelled) setState({ kind: 'message', text: parsed.unavailableMessage });
      }
    }
    void choose();
    return () => {
      cancelled = true;
    };
  }, [ageBand, childId, parsed]);

  if (!parsed) return null;

  async function start(slug: string) {
    const definition = getAdventureTemplate(slug);
    if (!definition) {
      setState({ kind: 'message', text: parsed!.unavailableMessage });
      return;
    }
    setStarting(true);
    try {
      await resumeOrStartSession(childId, definition);
      navigate(`/island/${childId}/locations/${parsed!.locationSlug}/adventures/${slug}`);
    } catch (error) {
      setState({ kind: 'error', text: adventureStartErrorMessage(error) });
      setStarting(false);
    }
  }

  return (
    <div className={styles.panel} role="dialog" aria-label={parsed.title}>
      <div className={styles.panelActions}>
        {state.kind === 'thinking' ? <p>Looking...</p> : null}
        {state.kind === 'message' ? <p>{state.text}</p> : null}
        {state.kind === 'error' ? (
          <p role="alert" className={styles.error}>
            {state.text}
          </p>
        ) : null}
        {state.kind === 'ready' ? (
          <button
            type="button"
            className={styles.goLink}
            disabled={starting}
            onClick={() => void start(state.slug)}
          >
            {starting ? 'Starting...' : 'Start the adventure'}
          </button>
        ) : null}
        <button type="button" className={styles.dismissButton} onClick={onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}
