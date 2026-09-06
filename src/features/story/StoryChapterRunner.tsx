import runnerStyles from '../adventures/AdventureRunner.module.css';
import stepStyles from '../adventures/steps/StepShell.module.css';
import { AdventureRunner } from '../adventures/AdventureRunner';
import { getAdventureTemplate } from '../adventures/content';
import { NarrativeStep } from '../adventures/steps/NarrativeStep';
import { ChoiceStep } from '../adventures/steps/ChoiceStep';
import { ReflectionStep } from '../adventures/steps/ReflectionStep';
import { CompanionBubble } from '../companion/CompanionBubble';
import { resolveNarrativeText } from './engine/types';
import type { StoryChapter } from './engine/types';
import { useStoryChapterRunner } from './useStoryChapterRunner';
import type { AgeBandValue } from '../child-profile/constants';
import type { AdventureDefinition } from '../adventures/engine/types';
import type { ReactNode } from 'react';

/**
 * Everything a caller needs to render one `ADVENTURE` scene itself
 * (ADR-019, part C).
 *
 * The default renderer is `AdventureRunner`, which owns its
 * `useAdventureSession` privately - and that privacy is exactly what stops a
 * 3D region driving a learning step from the room, because the castle's
 * method since SC-4 has been that *the view* holds the session, so a
 * portrait looked at and an option pressed on the card go through one
 * `submitAnswer` and cannot drift.
 *
 * A region supplies a renderer that holds the session and renders
 * `AdventureStepCard`, the component SC-4 extracted from `AdventureRunner`
 * for precisely this. One attempt is still one `AdventureSession`: this
 * changes who renders the scene, never how many sessions exist for it.
 */
export interface StoryAdventureRenderProps {
  childProfileId: string;
  definition: AdventureDefinition;
  ageBand: AgeBandValue;
  aiEnabled: boolean;
  backToMapHref: string;
  /** Call when the embedded adventure finishes. The Story Engine advances, not the caller. */
  onComplete: () => void;
}

/** What an `ADVENTURE` scene renders when a caller does not say otherwise. */
function defaultRenderAdventure({
  childProfileId,
  definition,
  ageBand,
  aiEnabled,
  backToMapHref,
  onComplete,
}: StoryAdventureRenderProps): ReactNode {
  return (
    <AdventureRunner
      key={definition.slug}
      childProfileId={childProfileId}
      definition={definition}
      ageBand={ageBand}
      aiEnabled={aiEnabled}
      backToMapHref={backToMapHref}
      onComplete={onComplete}
    />
  );
}

interface StoryChapterRunnerProps {
  childProfileId: string;
  ageBand: AgeBandValue;
  aiEnabled: boolean;
  storyProgressId: string;
  chapter: StoryChapter;
  flags: Record<string, string>;
  backToStoryHref: string;
  onFlag: (flagKey: string, flagValue: string) => Promise<void>;
  onChapterComplete: () => Promise<void>;
  /**
   * Renders an `ADVENTURE` scene. Defaults to the embedded
   * `AdventureRunner`, which is what every caller but a 3D region wants.
   *
   * This is a *rendering* seam and nothing more (ADR-019): it carries no
   * ability to advance a chapter, skip or complete a scene, grade an
   * answer, or create story progress. Those stay with the Story and
   * Adventure Engines, and `StoryChapterRunner` stays canonical - there is
   * deliberately no `CastleStoryRunner` for a region to reach for instead.
   */
  renderAdventure?: (props: StoryAdventureRenderProps) => ReactNode;
}

/**
 * Renders one chapter's current scene. All scene-sequencing logic lives in
 * useStoryChapterRunner; this component only dispatches to a renderer,
 * matching AdventureRunner's own "renders what it's told" shape. `ADVENTURE`
 * scenes embed the real, unmodified `AdventureRunner` (docs/ROADMAP.md
 * Phase 12 "adventure embedding") — its own correctness/hint/completion
 * logic is untouched; this component only observes when it finishes.
 */
export function StoryChapterRunner({
  childProfileId,
  ageBand,
  aiEnabled,
  storyProgressId,
  chapter,
  flags,
  backToStoryHref,
  onFlag,
  onChapterComplete,
  renderAdventure,
}: StoryChapterRunnerProps) {
  const {
    scene,
    skipAdventure,
    adventureJustCompleted,
    error,
    companionTurn,
    continueNarrative,
    chooseOption,
    continueReflection,
    handleAdventureComplete,
    continueAfterAdventure,
  } = useStoryChapterRunner(
    childProfileId,
    ageBand,
    aiEnabled,
    storyProgressId,
    chapter,
    flags,
    onFlag,
    onChapterComplete,
  );

  if (!scene) {
    return <p>Saving your progress in the story...</p>;
  }

  return (
    <div className={runnerStyles.page}>
      {error ? (
        <p className={runnerStyles.error} role="alert">
          {error}
        </p>
      ) : null}

      <CompanionBubble state={companionTurn} />

      {scene.kind === 'NARRATIVE' ? (
        <NarrativeStep
          key={scene.id}
          speaker={scene.speaker}
          text={resolveNarrativeText(scene, flags)}
          disabled={false}
          onContinue={continueNarrative}
        />
      ) : null}

      {scene.kind === 'CHOICE' ? (
        <ChoiceStep
          key={scene.id}
          prompt={scene.prompt}
          options={scene.options}
          disabled={false}
          onSelect={(optionId) => void chooseOption(optionId)}
        />
      ) : null}

      {scene.kind === 'REFLECTION' ? (
        <ReflectionStep
          key={scene.id}
          prompt={scene.prompt}
          disabled={false}
          onContinue={() => void continueReflection()}
        />
      ) : null}

      {scene.kind === 'ADVENTURE' ? (
        skipAdventure === null ? (
          <p>Loading the next part of the story...</p>
        ) : skipAdventure ? (
          <div className={stepStyles.card}>
            <p className={stepStyles.prompt}>You already finished this part of the story.</p>
            <button
              className={stepStyles.primaryButton}
              type="button"
              onClick={continueAfterAdventure}
            >
              Continue the story
            </button>
          </div>
        ) : getAdventureTemplate(scene.templateSlug) ? (
          <>
            {(renderAdventure ?? defaultRenderAdventure)({
              childProfileId,
              definition: getAdventureTemplate(scene.templateSlug)!,
              ageBand,
              aiEnabled,
              backToMapHref: backToStoryHref,
              onComplete: handleAdventureComplete,
            })}
            {adventureJustCompleted ? (
              <button
                className={stepStyles.primaryButton}
                type="button"
                onClick={continueAfterAdventure}
              >
                Continue the story
              </button>
            ) : null}
          </>
        ) : (
          <p role="alert">We could not find that part of the story.</p>
        )
      ) : null}
    </div>
  );
}
