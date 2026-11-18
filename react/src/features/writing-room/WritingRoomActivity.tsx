import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './WritingRoomActivity.module.css';
import {
  isWrittenStoryRefused,
  resumeOrStartSession,
  saveWrittenStory,
  type StoryArtifact,
  type WrittenStoryPart,
} from '../adventures/api';
import {
  WRITING_ROOM_ENCOURAGEMENT,
  WRITING_ROOM_REFUSAL,
} from '../adventures/content/writingRoomStories';
import type { AdventureDefinition } from '../adventures/engine/types';
import type { AgeBandValue } from '../child-profile/constants';
import { SpeechCaption } from '../../audio/speech/SpeechCaption';
import { useSpeech } from '../../audio/speech/useSpeech';
import { writingRoomLineId } from './writingRoomSpeech';
import {
  EXPLORER_MAX_CHARACTERS,
  OPTION_MARKS,
  PATHFINDER_MAX_TILES,
  canFinishSentences,
  choiceSteps,
  paragraphProblem,
  partsFor,
  sentenceIsComplete,
  sentencePreview,
  textStep,
  welcomeLine,
  writingStoryFor,
  OPTIONAL_SENTENCE_STEP_ID,
  type ChoiceStepModel,
} from './writingRoomModel';

/**
 * The Writing Room's write-your-story activity (SC-final-B), one flow per age band:
 *
 * - **Sprouts (3 to 4):** one tap at a time, a picture, a character and a word. Big targets,
 *   every prompt can be heard, and no reading is needed.
 * - **Pathfinders (5 to 6):** two or three sentences, each built by tapping authored word tiles.
 * - **Explorers (7 to 8):** a story starter, then a short typed paragraph.
 *
 * It is never required and grants nothing. Nothing is graded, nothing is sent to a model, and
 * the encouragement is authored. The story is saved once, at the end, through the existing
 * adventure session and `StoryArtifact` routes; a Sprout or Pathfinder sends only option ids, and
 * an Explorer's paragraph is screened by the server before it is stored. A paragraph the server
 * refuses is answered with a kind line, and neither the text nor a reason is shown back or logged.
 */
export interface WritingRoomDeps {
  startSession: (childId: string, story: AdventureDefinition) => Promise<{ id: string }>;
  saveStory: (
    childId: string,
    sessionId: string,
    parts: readonly WrittenStoryPart[],
  ) => Promise<StoryArtifact>;
}

const DEFAULT_DEPS: WritingRoomDeps = {
  startSession: resumeOrStartSession,
  saveStory: saveWrittenStory,
};

export interface WritingRoomActivityProps {
  childId: string;
  ageBand: AgeBandValue;
  /** Where "Back to the room" goes. */
  roomHref: string;
  /** Where "My stories" goes (the adventure log). */
  logHref: string;
  deps?: WritingRoomDeps;
}

type Phase = 'intro' | 'writing' | 'saving' | 'saved';

export function WritingRoomActivity({
  childId,
  ageBand,
  roomHref,
  logHref,
  deps = DEFAULT_DEPS,
}: WritingRoomActivityProps) {
  const story = useMemo(() => writingStoryFor(ageBand), [ageBand]);
  const [phase, setPhase] = useState<Phase>('intro');
  const [picks, setPicks] = useState<Record<string, readonly string[]>>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [paragraph, setParagraph] = useState('');
  const [saved, setSaved] = useState<StoryArtifact | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const speech = useSpeech({ childId, scopeName: 'writing-room-speech' });

  const steps = useMemo(() => (story ? choiceSteps(story) : []), [story]);
  const typed = useMemo(() => (story ? textStep(story) : undefined), [story]);

  const hear = useCallback(
    (stepId: string, text: string) => {
      if (!story) return;
      void speech.speak({
        reference: { kind: 'line', id: writingRoomLineId(story.slug, stepId) },
        fallbackText: text,
      });
    },
    [speech, story],
  );

  const save = useCallback(
    async (finalPicks: Record<string, readonly string[]>, finalParagraph: string) => {
      if (!story) return;
      setPhase('saving');
      setMessage(null);
      try {
        const session = await deps.startSession(childId, story);
        const artifact = await deps.saveStory(
          childId,
          session.id,
          partsFor(ageBand, finalPicks, finalParagraph),
        );
        setSaved(artifact);
        setPhase('saved');
      } catch (error) {
        setPhase('writing');
        // Kind and authored. It never repeats what the child wrote or says why.
        setMessage(
          isWrittenStoryRefused(error)
            ? WRITING_ROOM_REFUSAL
            : 'We could not put your story on the shelf just now. Please try again.',
        );
      }
    },
    [ageBand, childId, deps, story],
  );

  if (!story) {
    return (
      <div className={styles.page}>
        <p role="status">The empty books are resting right now. Let us write another time.</p>
        <Link className={styles.secondary} to={roomHref}>
          Back to the Writing Room
        </Link>
      </div>
    );
  }

  const caption = (
    <SpeechCaption
      state={speech.state}
      onReplay={() => void speech.replay()}
      onStop={speech.stop}
      onPause={speech.pause}
      onResume={speech.resume}
      speaker="Keeper Quill"
    />
  );

  if (phase === 'saved' && saved) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{saved.title}</h1>
        <p className={styles.encouragement} role="status">
          {WRITING_ROOM_ENCOURAGEMENT[ageBand]}
        </p>
        <div className={styles.book} aria-label="Your story">
          {saved.scenes.map((scene) => (
            <p key={scene.stepId} className={styles.sceneText}>
              {scene.text}
            </p>
          ))}
        </div>
        <div className={styles.actions}>
          <Link className={styles.primary} to={roomHref}>
            Back to the Writing Room
          </Link>
          <Link className={styles.secondary} to={logHref}>
            See my adventure log
          </Link>
        </div>
      </div>
    );
  }

  if (phase === 'intro') {
    const welcome = welcomeLine(story);
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{story.title}</h1>
        <p className={styles.prompt}>{welcome}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.listen} onClick={() => hear(story.entryStepId, welcome)}>
            Hear Keeper Quill
          </button>
          <button type="button" className={styles.primary} onClick={() => setPhase('writing')}>
            Let us write
          </button>
          <Link className={styles.secondary} to={roomHref}>
            Not now
          </Link>
        </div>
        {caption}
      </div>
    );
  }

  const busy = phase === 'saving';
  const notice = message ? (
    <p className={styles.notice} role="alert">
      {message}
    </p>
  ) : null;

  // ---- Sprouts: one tap at a time -------------------------------------------------------
  if (ageBand === 'SPROUT') {
    const step = steps[stepIndex];
    if (!step) return null;
    const choose = (optionId: string) => {
      const next = { ...picks, [step.id]: [optionId] };
      setPicks(next);
      if (stepIndex + 1 < steps.length) setStepIndex(stepIndex + 1);
      else void save(next, '');
    };
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{story.title}</h1>
        <p className={styles.progress}>
          Step {stepIndex + 1} of {steps.length}
        </p>
        <p className={styles.prompt}>{step.prompt}</p>
        <button type="button" className={styles.listen} onClick={() => hear(step.id, step.prompt)}>
          Hear it
        </button>
        <div className={styles.bigChoices} role="group" aria-label={step.prompt}>
          {step.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={styles.bigChoice}
              disabled={busy}
              onClick={() => choose(option.id)}
            >
              <span aria-hidden="true" className={styles.mark}>
                {OPTION_MARKS[option.id] ?? '⭐'}
              </span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
        <HintLadder key={step.id} step={step} />
        {busy ? <p role="status">Putting your story on the shelf...</p> : null}
        {notice}
        {caption}
      </div>
    );
  }

  // ---- Pathfinders: word tiles into sentences -------------------------------------------
  if (ageBand === 'PATHFINDER') {
    const step = steps[stepIndex];
    if (!step) return null;
    const chosen = picks[step.id] ?? [];
    const labelOf = (id: string) => step.options.find((option) => option.id === id)?.label ?? '';
    const builtCount = steps.filter((candidate) => sentenceIsComplete(picks[candidate.id] ?? [])).length;
    const complete = sentenceIsComplete(chosen);
    const setChosen = (ids: readonly string[]) => setPicks({ ...picks, [step.id]: ids });
    const isLast = stepIndex + 1 >= steps.length;
    const finish = () => {
      // Drop an unfinished sentence: only complete ones are sent.
      const sent = Object.fromEntries(
        Object.entries(picks).filter(([, ids]) => sentenceIsComplete(ids)),
      );
      void save(sent, '');
    };
    const afterThis = complete && canFinishSentences(builtCount);
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{story.title}</h1>
        <p className={styles.progress}>
          Sentence {stepIndex + 1} of {steps.length}
          {step.id === OPTIONAL_SENTENCE_STEP_ID ? ' (you can finish without it)' : ''}
        </p>
        <p className={styles.prompt}>{step.prompt}</p>
        <button type="button" className={styles.listen} onClick={() => hear(step.id, step.prompt)}>
          Hear it
        </button>
        <p className={styles.sentence} aria-live="polite" aria-label="Your sentence so far">
          {chosen.length ? sentencePreview(chosen.map(labelOf)) : 'Tap the tiles to build your sentence.'}
        </p>
        <div className={styles.tiles} role="group" aria-label="Word tiles">
          {step.options.map((option) => {
            const used = chosen.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                className={styles.tile}
                disabled={busy || used || chosen.length >= PATHFINDER_MAX_TILES}
                onClick={() => setChosen([...chosen, option.id])}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy || chosen.length === 0}
            onClick={() => setChosen(chosen.slice(0, -1))}
          >
            Take back a tile
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy || chosen.length === 0}
            onClick={() => setChosen([])}
          >
            Start this sentence again
          </button>
          {complete && !isLast ? (
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => setStepIndex(stepIndex + 1)}
            >
              Next sentence
            </button>
          ) : null}
          {afterThis || (complete && isLast) ? (
            <button type="button" className={styles.primary} disabled={busy} onClick={finish}>
              I am finished
            </button>
          ) : null}
        </div>
        <HintLadder key={step.id} step={step} />
        {busy ? <p role="status">Putting your story on the shelf...</p> : null}
        {notice}
        {caption}
      </div>
    );
  }

  // ---- Explorers: a starter, then a typed paragraph ---------------------------------------
  const starterStep = steps[0];
  const starter = starterStep ? (picks[starterStep.id] ?? [])[0] : undefined;
  const problem = paragraphProblem(paragraph);
  const remaining = EXPLORER_MAX_CHARACTERS - paragraph.length;
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{story.title}</h1>
      {starterStep ? (
        <fieldset className={styles.starters}>
          <legend className={styles.prompt}>{starterStep.prompt}</legend>
          {starterStep.options.map((option) => (
            <label key={option.id} className={styles.starter}>
              <input
                type="radio"
                name="story-starter"
                value={option.id}
                checked={starter === option.id}
                onChange={() => setPicks({ ...picks, [starterStep.id]: [option.id] })}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {typed ? (
        <>
          <label className={styles.prompt} htmlFor="writing-room-paragraph">
            {typed.prompt}
          </label>
          <button type="button" className={styles.listen} onClick={() => hear(typed.id, typed.prompt)}>
            Hear it
          </button>
          <textarea
            id="writing-room-paragraph"
            className={styles.paragraph}
            rows={7}
            maxLength={EXPLORER_MAX_CHARACTERS + 50}
            value={paragraph}
            disabled={busy}
            // Free text: kept in this component only, sent once on save, never logged or re-shown.
            autoComplete="off"
            spellCheck
            onChange={(event) => setParagraph(event.target.value)}
          />
          <p className={styles.counter} aria-live="polite">
            {problem === 'too-short'
              ? `Keep going. A few more words, please.`
              : problem === 'too-long'
                ? `That is a little long. Please make it ${Math.abs(remaining)} characters shorter.`
                : `${remaining} characters left.`}
          </p>
          <HintLadder step={typed} />
        </>
      ) : null}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={busy || !starter || problem !== null}
          onClick={() => void save(picks, paragraph)}
        >
          Put it on the shelf
        </button>
        <Link className={styles.secondary} to={roomHref}>
          Not now
        </Link>
      </div>
      {busy ? <p role="status">Putting your story on the shelf...</p> : null}
      {notice}
      {caption}
    </div>
  );
}

/** "Need an idea?": the authored hint ladder, one rung at a time. No model, no judging. */
function HintLadder({ step }: { step: ChoiceStepModel }) {
  const [level, setLevel] = useState(0);
  if (step.hints.length === 0) return null;
  return (
    <div className={styles.hints}>
      {level > 0 ? (
        <p className={styles.hint} role="status">
          {step.hints[Math.min(level, step.hints.length) - 1]}
        </p>
      ) : null}
      {level < step.hints.length ? (
        <button type="button" className={styles.secondary} onClick={() => setLevel(level + 1)}>
          {level === 0 ? 'Need an idea?' : 'Another idea?'}
        </button>
      ) : null}
    </div>
  );
}
