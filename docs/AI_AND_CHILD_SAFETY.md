# AI and Child Safety

This document defines product requirements, not legal advice. Obtain qualified privacy and child-safety review before public launch.

## Safety architecture

Use multiple layers:

1. Curated adventure and topic boundaries.
2. Limited child input modes and lengths.
3. Input normalization and classification.
4. Prompt templates with explicit age and content constraints.
5. Structured output schemas.
6. Provider safety controls where available.
7. Application-level output validation.
8. Allowlisted UI components and actions.
9. Authored fallback content.
10. Metadata audit and human review workflow.

No single model instruction is considered sufficient.

## Child input policy

MVP preferred inputs:
- taps and multiple choice;
- ordering and drag/drop;
- numbers;
- short words or sentences;
- curated curiosity prompts;
- optional speech converted to ephemeral text.

Reject or redirect:
- contact details;
- precise location;
- school name;
- passwords or account information;
- requests to move communication elsewhere;
- sexual content;
- graphic violence;
- self-harm content;
- instructions for dangerous activities;
- adult financial or legal transactions.

When concerning content appears, do not interrogate the child. Give a brief, calm, age-appropriate response and guide them to a trusted grown-up. The parent-facing system should follow an approved escalation policy.

## Companion boundaries

Chatty must never:
- ask the child to keep secrets from adults;
- imply the child is its only or best friend;
- punish absence or demand return visits;
- ask for photographs, recordings, location, school, full name, or contact information;
- provide medical, legal, or emergency instructions beyond directing the child to a trusted adult;
- encourage purchases;
- use shame, fear, romantic language, or emotional pressure;
- simulate a deceased or real person;
- claim certainty when it does not know.

## Prompt context minimization

Send only what is needed:
- age band, not exact birthdate;
- curated interest tags, not full profile history;
- current adventure and step;
- recent bounded actions;
- learning objective and desired hint level;
- permitted response type and length.

Do not send parent email, child legal name, exact age, raw audio, or unrelated historical interactions.

## Structured response example

```ts
interface CompanionTurn {
  spokenText: string;
  emotion: 'CHEERFUL' | 'CURIOUS' | 'CALM' | 'ENCOURAGING';
  intent: 'NARRATE' | 'ASK' | 'HINT' | 'CELEBRATE' | 'REDIRECT';
  choices?: Array<{ id: string; label: string }>;
  safetyDisposition: 'ALLOW' | 'REDIRECT' | 'STOP';
}
```

Validation rules:
- strict maximum length by age band;
- no URLs;
- no requests for personal information;
- choices must match server-authorized action IDs;
- no markup except supported narration tokens;
- invalid output invokes deterministic fallback.

## Parent transparency

Parents should be able to see:
- which AI features are enabled;
- plain-language descriptions of AI use;
- learning summaries;
- data controls and deletion options;
- safety events requiring attention, using carefully reviewed language.

Do not expose raw child transcripts as the default progress experience.

## Data retention principle

Keep the least data for the shortest useful time. Separate operational telemetry from child content. Document retention and deletion behavior before collecting free text or audio.

