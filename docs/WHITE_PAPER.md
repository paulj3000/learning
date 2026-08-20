# Learning Adventure Island
### Project White Paper — Current State and Trajectory

*Last updated: 2026-08-20*

---

## 1. Executive Summary

Learning Adventure Island is an AI-powered learning world for children ages 3–8, built on AWS Amplify Gen 2. It is not a worksheet catalog or a general-purpose chatbot wrapped in a kid-friendly skin. It is a persistent, explorable island where a child's learning has a visible, lasting effect on the world itself: a bridge gets rebuilt because the child solved a measurement problem, a forest floor blooms because a story was finished, a dragon appears in a new sanctuary because an adventure was completed weeks earlier.

As of this writing, the project has shipped a complete MVP (Phases 0–8 of the original roadmap: parent accounts, the island shell, a deterministic adventure engine, a safety-reviewed AI companion, three full learning locations, a parent dashboard, and a formal hardening/pilot phase), and has gone considerably further: a nine-phase "explorable world" arc (Phases 9–17) that replaced static location screens with a real 2D game world (Phaser), added a Story Engine layer, built five full narrative adventure arcs across all three age bands, connected story completion to lasting world-wide changes, and shipped household co-presence so siblings can play the same adventure together in real time.

Phase 8's hardening work culminated in a **closed pilot run with real recruited families**, which surfaced no major issues. The product has been reviewed against a threat model, an authorization review, a privacy/child-safety review, and an accessibility audit — each of which found and fixed real issues rather than rubber-stamping the design. A live AI red-team pass against Amazon Bedrock (17 adversarial fixtures) recorded zero safety-boundary violations.

In short: **the core product is built, safety-reviewed, and pilot-tested.** What remains is not "does the architecture work" but a known, tracked list of hardening items (see Section 8) and product decisions still pending (final art direction, formal curriculum mapping, legal/retention policy) before a public launch.

---

## 2. Product Vision

**Child-facing promise:**
> Explore a magical island where every problem you solve, question you ask, and idea you create changes the world.

**Parent-facing promise:**
> Purposeful, creative screen time with visible learning outcomes, strong controls, and safe AI personalization.

Every experience in the product is built around one non-negotiable loop:

1. A character or location has a meaningful problem.
2. The child investigates and makes choices.
3. The child practices one or more skills.
4. The AI companion gives an adaptive hint when needed.
5. The child's action produces a visible, lasting change in the world.
6. The system records evidence of the practiced skill.
7. The parent sees a plain-language summary — never a raw chat transcript.

What differentiates this from "an AI chatbot for kids" is the combination of a persistent world, curriculum-tagged adventure content, an age-adaptive engine, child-safe structured AI generation, consequences that actually persist, and parent-readable evidence of learning — with correctness and progression always decided by deterministic application code, never by the model.

---

## 3. Who It's For

- **Parents/guardians** create and own the account, create up to three child profiles, set age band and interests, review plain-language progress summaries, and control AI, voice, session time, and data retention — including a full account/data deletion flow.
- **Children** use a parent-managed profile with no email of their own, explore the island through large visual controls and narration, and never receive an unrestricted chat box. Every AI interaction is bounded to a specific adventure step or curated prompt.
- **Administrators/content designers** (role scaffolded, UI not yet built) would manage curriculum content, safety rules, and review flagged AI interactions without exposing unnecessary child data.

---

## 4. The World, As Built Today

The island currently has five real, spatially explorable locations, each rendered with a real 2D game engine (Phaser) rather than static screens:

| Location | What happens there |
|---|---|
| **Welcome Harbor** | Onboarding, companion selection, the visual map, and the adventure log. The first production explorable environment, with a full tilemap, collision, NPC framework, and Chatty follow behavior. |
| **Pirate Builder Bay** | Applied numeracy, measurement, and instructions. "Repair the Moonlight Bridge" — solve the bridge's construction problems and watch it physically rebuild, unlocking a new area. |
| **Wonderwild Forest** | Curiosity turned into bounded science content. "Buzz and the Waggle Dance" — shrink into a beehive and learn evidence-based facts about honeybee communication, anchored to cited sources. |
| **Storykeeper Castle** | Collaborative storytelling. "The Storykeeper's Tale" — the child picks a hero and setting, gets an AI-varied scene per choice, then answers comprehension and sequencing questions grounded in fixed, authored text. |
| **Dragon's Sanctuary, Fossil Ridge Camp, the Writing Room, Bolt's Workshop** | Secret locations that unlock only after completing specific story content elsewhere — the island's proof that learning has *lasting*, cross-location consequences, not just a per-session badge. |

Beyond the original three MVP locations, the product now includes:

- **A Story Engine** layered above the deterministic adventure engine, supporting multi-chapter narratives with branching, resumable progress, and adventures embedded inside chapters. The reference story, *The Dragon of Ember Mountain*, spans five chapters.
- **An Adventure Library**: five full, age-gated, interest-ranked story arcs spanning all three age bands (Sprouts 3–4, Pathfinders 5–6, Explorers 7–8) — including the first Sprout-playable content in the product.
- **Island Progression**: completing a story doesn't just end it — it unlocks new locations, restores ecosystems, transforms terrain, brings in new characters, and reflects the real-world season on Welcome Harbor.
- **Household Co-Presence**: two of a parent's own children can join the same adventure instance and see each other's avatar, position, and discrete validated actions in real time — with zero free-form communication surface between them (no chat, no shared drawing, nothing to moderate because nothing expressive is transmitted).

Every adventure ends in a persistent `WorldChange` — a durable record that the island itself now reflects what the child did.

---

## 5. Architecture

```text
React / Vite / TypeScript (strict mode) client, Phaser for the explorable world
  |
  v
Amplify Auth (Cognito, parent accounts only)
Amplify Data (AppSync + DynamoDB, owner-scoped authorization)
Amplify Functions (privileged mutations, conflict resolution, operational metrics)
Amplify AI Kit (structured generation routes -> Amazon Bedrock)
  |
  v
CloudWatch dashboards, alarms, and a Bedrock cost budget
```

**Layering discipline**, enforced architecturally, not just by convention:

```text
World Engine (Phaser: movement, maps, animation, collision)
     -> Story Engine (chapters, scenes, narrative state, bounded choices)
     -> Adventure Engine (deterministic challenge progression, validation, hints)
     -> Learning Rules / AI Companion (evaluation / narration, never both)
     -> World State (permanent consequences, unlocks, discoveries)
```

No layer takes over another's responsibility. In particular, the Phaser rendering layer never decides whether an answer is correct, never awards progress, and never calls an AI route directly — it fires events across a plain, engine-free event bus into already-audited application code.

**Every AI call** follows the same pipeline: child action → adventure state machine → learning-objective selector → safe context builder → structured AI generation route → schema validation → safety-disposition check → approved UI component → progress event. Every route call carries an explicit adventure template ID, age band, allowed topic, learning objective, and maximum output length, and every response has an authored fallback in code — the model is never the only thing standing between a child and an unsafe response.

Backend authorization is deny-by-default: every model uses Cognito owner-based authorization, verified by a source-level authorization review (Section 8) rather than assumed correct.

---

## 6. Safety Architecture

The AI companion, "Chatty the Parrot," operates under a ten-layer safety model — curated content boundaries, limited input modes, prompt templates with explicit constraints, structured output schemas, application-level output validation, allowlisted UI actions, authored fallback content, and (partially built) a metadata audit/human-review workflow. **No single model instruction is treated as sufficient anywhere in the system.**

Chatty is explicitly prohibited from asking a child to keep secrets, implying it is the child's only friend, requesting any personal or contact information, giving medical/legal/emergency advice beyond directing the child to a trusted adult, using shame or fear, or claiming to be a real or deceased person or to be conscious.

This isn't just a design document. A live red-team pass with 17 adversarial fixtures — direct prompt injection, requests for personal information, dependency-language elicitation, impersonation attempts — was run against the actual deployed model. **Zero fixtures produced a safety-boundary violation.** The pass did surface and fix a real bug: the model was returning free-text mood words instead of one of four allowed emotion values, causing valid responses to fail structural validation. The fix (an explicit prompt instruction plus a defense-in-depth synonym normalizer) raised the validator pass rate from 29% to 82%, with the remaining failures being the length guardrail correctly doing its job — an over-length response safely falls back to authored content rather than reaching a child.

---

## 7. What's Actually Built

All 18 phases of the roadmap through Phase 17 are functionally complete:

- **Phases 0–7 (MVP core)**: project scaffold, parent accounts and child profiles, the island shell, a fully deterministic adventure state engine, the safety-reviewed AI companion, and a full complete adventure in each of the three original MVP locations, plus a parent dashboard summarizing skills — never raw transcripts.
- **Phase 8 (Hardening and Pilot)**: a full data-deletion flow (per-child and full-account, cascading across every model), a source-level authorization review, a STRIDE-organized threat model, a privacy/child-safety review (which found and fixed a real gap — safety events had no parent-facing display), an accessibility audit (which found and fixed four WCAG-AA color-contrast failures, including the AI companion's own text), a live AI red-team suite, operational CloudWatch dashboards and alarms (including a Bedrock cost budget), a live owner-isolation authorization test against two real accounts, and **a closed pilot run with real recruited families, with no major issues found**.
- **Phases 9–17 (Explorable World arc)**: the island rebuilt as a real Phaser-driven 2D world; Welcome Harbor, Pirate Builder Bay, and Wonderwild Forest and Storykeeper Castle rebuilt as spatial locations sharing one location-agnostic rendering engine; a Story Engine layer and reference story; a five-arc, age-gated Adventure Library; island-wide progression (unlocking, restoration, new characters, seasonal state) tied to story completion; and household co-presence for siblings, with zero communication surface between children by design.

**By the numbers** (current codebase): 163 application source files, 82 test files, five fully spatial locations, five complete narrative arcs across all three age bands, and a growing island of secret, story-gated locations.

---

## 8. Verification and Quality Posture

This project has been unusually disciplined about not marking anything "done" without either passing tests or an explicit, named blocker. Every phase's implementation notes record exactly what was verified and what remains unverified, rather than assuming success.

- **Automated tests**: 84 test files / 648 tests passing (Vitest + React Testing Library), plus Playwright smoke coverage of unauthenticated routes, plus a full production build check on every change.
- **Type safety**: TypeScript strict mode throughout, `any` avoided, all external and AI-generated data validated at runtime — never trusted on the strength of a schema declaration alone.
- **Authorization review**: every model's Cognito owner-based rule confirmed correct against the product's actual trust boundary, plus a live test with two real accounts confirming cross-account access is denied.
- **Threat model**: assets, actors, and trust boundaries mapped STRIDE-style; cross-family data exposure — weighted as the most sensitive risk for this product's users — has no open gap.
- **Privacy and child-safety review**: every requirement in the safety-architecture document checked against actual code, not the spec's prose.
- **Accessibility audit**: every interactive element confirmed to be a real button or link (no clickable `<div>`s anywhere in the codebase), color contrast recomputed against actual usage and fixed where it failed.
- **Live AI red-team suite**: run against real Amazon Bedrock output, not mocks (Section 6).
- **Closed parent pilot**: run with real families; no major issues found.

Two real upstream bugs in Amplify's own AI Kit tooling were found, root-caused, and fixed during this work (a missing IAM grant for cross-Region Bedrock inference profiles, and an unsafe GraphQL enum declaration for AI-generated fields that caused total response loss on a harmless casing mismatch) — both documented in code and in the implementation log so they don't have to be rediscovered if the model choice ever changes.

Recent sessions also diagnosed and fixed three separate CI/CD deployment issues that only surfaced against a real pipeline deploy — a circular nested-stack CloudFormation dependency, a DynamoDB Stream activation race, and a stale stream-ARN attribute in Amplify's table-manager tooling — each fixed at the root cause rather than worked around.

---

## 9. Known Risks and Open Items

Tracked explicitly, not hidden:

- `claimCoopSlot`'s atomic slot-claim mechanism relies on a DynamoDB storage assumption (JSON stored as a native Map, not a string) that is plausible but not yet confirmed against a live table — will fail loudly, not silently, if wrong.
- Only one adventure ("Repair the Moonlight Bridge") is currently wired for co-op play; the underlying mechanism is generic, so widening this is a content/picker change, not an engine change.
- No Bedrock Guardrails resource is provisioned yet as an additional AI safety layer.
- Child free-text input has no renderer yet, so the "reject or redirect" input-safety rules (contact details, unsafe topics, etc.) are specified but not yet exercised end-to-end — relevant once an open-ended input step is built.
- There is no admin/reviewer role or UI yet for the "metadata audit and human review" safety layer; safety events are currently only visible to the owning parent.
- Bedrock model choice (Claude Haiku 4.5) is a deliberate placeholder pending a formal model-selection decision.
- A `ChildWorldState` model (tracking discovered objects/characters) has been specified but deliberately not built until a concrete deliverable needs it.

---

## 10. Decisions Still Pending

- Final visual design direction and art pipeline.
- Bedrock model selection by region, capability, latency, and cost.
- Text-to-speech provider and voice consent model.
- Formal curriculum framework mapping.
- Legal/privacy review and data retention schedule.

None of these block continued engineering work, but all of them block a public (non-pilot) launch.

---

## 11. What's Explicitly Out of Scope

By design, not by omission: social networking, child-to-child messaging, public profiles or leaderboards, open-ended AI chat, user-generated public content, live classrooms, real-money purchases by children, advertising, facial recognition, emotion inference from camera or voice, voice cloning, unrestricted web search, and autonomous AI agents taking external actions. These exclusions are treated as product principles, not a temporary MVP cut list.

---

## 12. What's Next

With the explorable-world arc and household co-presence complete, the immediate frontier is widening rather than deepening: more adventures wired for co-op play, a Bedrock Guardrails evaluation, an admin/reviewer role for the safety-audit workflow, and the pending decisions in Section 10. Beyond that, the roadmap already names a second wave of locations — Robot Repair Reef, Creature Care Cove, Mystery Marsh, Invention Volcano, Make-Believe Market, and Music and Motion Lagoon — plus seasonal island events, additional AI companions, and educator/homeschool accounts, all held as post-MVP candidates rather than committed scope.

---

## 13. Closing

Learning Adventure Island set out to prove a specific, harder claim than "an app that teaches kids things with AI": that a child's learning could visibly and permanently change a persistent world, that an AI companion could be woven through that world safely by architecture rather than by policy alone, and that "safe by architecture" could survive contact with a real, live model and real families rather than just a design document.

Eighteen roadmap phases in, with a completed hardening pass, a clean live red-team result, and a closed pilot that surfaced no major issues, that claim is holding up. What remains is the harder, less glamorous work of every real product at this stage: closing the last tracked gaps, making the handful of pending business decisions, and widening what already works rather than re-proving that it does.
