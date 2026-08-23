# Prompt and Schema Guide

## Prompt composition

Prompts should be assembled from versioned sections:
- system safety policy;
- companion identity;
- age-band style policy;
- adventure template context;
- current step and allowed actions;
- learning objective;
- hint level;
- output schema;
- prohibited behavior;
- fallback instruction.

Do not concatenate untrusted child text into instruction sections. Delimit it as data.

## Example generation request

```ts
interface GenerateCompanionTurnInput {
  childProfileId: string;
  sessionId: string;
  stepId: string;
  actionId?: string;
  hintLevel: 0 | 1 | 2 | 3 | 4;
}
```

The server resolves all trusted context from IDs. The browser does not send persona instructions, age instructions, learning objectives, or authorized action lists.

## Tutoring generation request (Phase 27)

The tutor route is a second, narrower generation route
(`generateTutorTurn`, `amplify/data/resource.ts`), with its own system
prompt (`amplify/data/tutorPersona.ts`) and its own version number in the
audit trail. Its argument list *is* the safe-context contract:

```ts
interface TutorContext {
  ageBand: 'SPROUT' | 'PATHFINDER' | 'EXPLORER';
  strategy: 'EXPLAIN' | 'ASK_GUIDING_QUESTION' | 'GIVE_HINT' | 'ENCOURAGE' | 'SWITCH_REPRESENTATION';
  maxLength: number;
  skillTitle: string;        // authored curriculum copy
  skillDescription: string;  // authored curriculum copy
  allowedVocabulary: string[];
  knownPrerequisiteTitles: string[];
  allowedRepresentations: Array<'numeric' | 'visual' | 'word-problem' | 'game-interaction'>;
  questTitle?: string;       // authored quest copy, for story continuity
  questStageTitle?: string;
  hintLevel: number;
  authoredBaseText?: string; // the step's own approved hint at this rung
}
```

Every field is authored content or a bounded scalar. There is no field for
a child profile id, nickname, age, mastery status, counts, error pattern,
history, or free text, so the "send only what is needed" rule above is
enforced by the schema rather than by the caller.

The response schema is deliberately narrower than `CompanionTurn`: no
`choices`, because a tutoring turn never drives gameplay.

```ts
interface TutorTurn {
  spokenText: string;
  strategy: TutorStrategy;   // must equal the requested strategy
  representation?: 'numeric' | 'visual' | 'word-problem' | 'game-interaction';
  emotion: 'CHEERFUL' | 'CURIOUS' | 'CALM' | 'ENCOURAGING';
  safetyDisposition: 'ALLOW' | 'REDIRECT' | 'STOP';
}
```

Validation rules, in addition to the shared length/URL/personal-information
checks:
- the returned `strategy` must equal the one requested (the hint ladder
  chose it, not the model);
- no learning judgment: no claim about what the child has mastered, what
  level or grade they are at, or what they must learn next;
- no curriculum term outside that skill's authored vocabulary;
- `representation` only on a `SWITCH_REPRESENTATION` turn, and only one the
  curriculum authored for that skill;
- invalid output invokes the deterministic per-strategy fallback.

## Style limits

### Sprout
- one or two short sentences;
- concrete vocabulary;
- at most two choices;
- narration-friendly.

### Pathfinder
- two or three short sentences;
- one clear question;
- at most three choices.

### Explorer
- up to four concise sentences;
- may invite a short explanation;
- at most four choices.

## Parent summary schema

```ts
interface ParentAdventureSummary {
  title: string;
  summary: string;
  skillsPracticed: Array<{
    objectiveCode: string;
    evidence: string;
    supportLevel: 'INDEPENDENT' | 'LIGHT_HINTS' | 'GUIDED';
  }>;
  worldChange: string;
  suggestedOfflineActivity?: string;
}
```

The summary must come from verified session evidence. AI may phrase it, but may not invent skills, results, or diagnoses.

