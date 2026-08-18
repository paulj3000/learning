# Content Sources and Review Workflow

This document covers nature/science adventure content, wherever it lives.
It started as a Wonderwild Forest rule (`docs/ROADMAP.md` Phase 6, the
first location to make factual claims) and was widened in Phase 15, when
the Adventure Library added science content outside that location for the
first time ("Dinosaur Expedition" and "Save the Butterfly Garden"). It
exists because science content can be factually wrong in a way that
story/counting content cannot: a mis-stated fact is a credibility and
trust problem for parents, not just a gameplay bug.

## Why this is separate from general content authoring

Most adventures (Pirate Builder Bay, Storykeeper Castle, the building and
mystery library arcs) are either pure game logic (counting, ordering,
patterns) or open-ended fiction with no factual claim to get wrong. Some
adventures make real claims about the natural world: what an animal does,
why, how. Those claims need a traceable source and a lightweight review
step before they reach a child, the same way a hint ladder needs a
correctness check before it reaches the engine.

## Authoring rule

Every `AdventureDefinition` that states a fact about the real world must
carry a `sources` doc comment directly above its `export const` (or above
the group of definitions in its module, when one module holds a single
arc's challenges), listing:
- the specific claim(s) made in the adventure's authored (non-AI) text;
- a real, checkable source for each claim (a field consensus, not a single
  blog post; prefer widely-cited science communication over a primary
  paper a reviewer cannot quickly verify);
- the date the claim was last checked against that source.

AI-narrated variation (`aiNarrated: true` narrative steps,
`generateCompanionTurn` with `authoredBaseText`) never introduces new
factual claims of its own; it is instructed, and separately validated, to
rephrase the authored text without changing its meaning or inventing
facts (`amplify/data/chattyPersona.ts`, `authoredBaseText` handling). The
factual accuracy of such an adventure is therefore fully determined
by its authored text, not by anything the model generates at runtime,
consistent with `CLAUDE.md` section 7 (correctness lives in application
code).

## Review workflow (MVP)

There is no admin/content-designer role yet (`docs/IMPLEMENTATION_STATUS.md`
"Known risks/TODOs" tracks this gap for every content type). Until one
exists, source review is a code-review step:

1. The author cites sources in the doc comment described above.
2. A second person (reviewer on the pull request) checks each cited claim
   against its source before the adventure content is merged.
3. Any later correction updates both the authored text and the doc
   comment's "checked" date in the same change.

Revisit once the Administrator/content designer role (`CLAUDE.md` section
2) exists: source citation and review status should move from a code
comment into structured, queryable fields on the content record.
