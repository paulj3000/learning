import { useState } from 'react';
import styles from './RepresentationAid.module.css';
import { BuildInteraction } from '../interaction/components/BuildInteraction';
import { DecodeInteraction } from '../interaction/components/DecodeInteraction';
import { DragSortInteraction } from '../interaction/components/DragSortInteraction';
import { MeasureInteraction } from '../interaction/components/MeasureInteraction';
import { SplitInteraction } from '../interaction/components/SplitInteraction';
import { evaluateInteraction } from '../interaction/evaluate';
import type { InteractionAnswer } from '../interaction/types';
import type { RepresentationAid as RepresentationAidContent } from './content/representationAids';

interface RepresentationAidProps {
  aid: RepresentationAidContent;
}

/**
 * Renders one authored practice aid beside the step a child is stuck on
 * (roadmap Phase 21's "partial scaffold" rung, Phase 22's interaction
 * library, Phase 27's `SWITCH_REPRESENTATION` strategy). This is the piece
 * that makes "let's try it a different way" something a child can touch.
 *
 * Deliberately *not* graded, and that is the whole design:
 *
 * - it calls no API, records no `SkillEvidence`, and never touches
 *   `upsertSkillProgress`, so playing with it cannot count against a child;
 * - it never advances the adventure. `getNextStepId` still runs only on the
 *   real step's own answer, so the deterministic engine is untouched
 *   (CLAUDE.md section 7);
 * - its feedback is one authored line of encouragement, shown however the
 *   child answers. `evaluateInteraction` is used only to decide whether to
 *   add "that matches" to it, never to pass or fail anyone.
 *
 * The manipulative is a way of looking at the idea, not a second test of it.
 */
export function RepresentationAid({ aid }: RepresentationAidProps) {
  const [tried, setTried] = useState(false);
  const [matched, setMatched] = useState(false);

  function handleAnswer(answer: InteractionAnswer) {
    setTried(true);
    setMatched(evaluateInteraction(aid.skillParams, answer) === 'correct');
  }

  const { presentation } = aid;

  return (
    <section className={styles.panel} aria-label="Another way to see it">
      <h2 className={styles.heading}>Another way to see it</h2>
      <p className={styles.note}>
        This one is just for trying out. Nothing here counts, so have a play.
      </p>

      {presentation.mechanic === 'BUILD' ? (
        <BuildInteraction
          prompt={presentation.prompt}
          availablePieces={presentation.availablePieces}
          disabled={false}
          onSubmit={(selectedPieceIds) => handleAnswer({ mechanic: 'BUILD', selectedPieceIds })}
        />
      ) : null}

      {presentation.mechanic === 'SPLIT' ? (
        <SplitInteraction
          prompt={presentation.prompt}
          totalLabel={presentation.totalLabel}
          partsCount={presentation.partsCount}
          disabled={false}
          onSubmit={(parts) => handleAnswer({ mechanic: 'SPLIT', parts })}
        />
      ) : null}

      {presentation.mechanic === 'DRAG_SORT' ? (
        <DragSortInteraction
          prompt={presentation.prompt}
          items={presentation.items}
          disabled={false}
          onSubmit={(order) => handleAnswer({ mechanic: 'DRAG_SORT', order })}
        />
      ) : null}

      {presentation.mechanic === 'MEASURE' ? (
        <MeasureInteraction
          prompt={presentation.prompt}
          unit={presentation.unit}
          disabled={false}
          onSubmit={(value) => handleAnswer({ mechanic: 'MEASURE', value })}
        />
      ) : null}

      {presentation.mechanic === 'DECODE' ? (
        <DecodeInteraction
          prompt={presentation.prompt}
          prompts={presentation.prompts}
          choices={presentation.choices}
          disabled={false}
          onSubmit={(matches) => handleAnswer({ mechanic: 'DECODE', matches })}
        />
      ) : null}

      {tried ? (
        <p className={styles.encouragement} role="status">
          {matched ? `That matches. ${aid.encouragement}` : aid.encouragement}
        </p>
      ) : null}
    </section>
  );
}
