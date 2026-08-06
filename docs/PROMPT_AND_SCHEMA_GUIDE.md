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

