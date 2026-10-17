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
            <AdventureRunner
              key={scene.id}
              childProfileId={childProfileId}
              definition={getAdventureTemplate(scene.templateSlug)!}
              ageBand={ageBand}
              aiEnabled={aiEnabled}
              backToMapHref={backToStoryHref}
              onComplete={handleAdventureComplete}
            />
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
