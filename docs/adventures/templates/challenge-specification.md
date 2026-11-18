# Challenge Specification: `<challenge name>`

- **Status:** `<Draft | In review | Owner approved>` (template version 1, governed by [`docs/adventures/challenge-standard.md`](../challenge-standard.md))
- **Owner:** Project owner
- **Last reviewed:** `<YYYY-MM-DD>`

> **How to use.** Copy this file once per challenge type and replace every `<placeholder>`.
> Correctness is always decided by Django application code; the engine and the browser only
> display and collect input, and no model ever grades. Prefer the existing sources (a
> `ChallengeSpec` generator, a Question Studio pool, an authored adventure step) over anything new.
> Write `<TBD: owner decision>` for anything undecided. Read
> [`challenge-standard.md`](../challenge-standard.md) and
> [`educational-content-standard.md`](../educational-content-standard.md) first.

## 1. Identity

| Field | Value |
|---|---|
| Challenge name (internal) | `<name>` |
| Challenge id or slug | `<id>` |
| Adventure and quest | `<adventure slug> / <quest slug or none>` |
| Trello card | `<card id and title>` |

## 2. Learning objective

| Objective code | Skill described for parents |
|---|---|
| `<code>` | `<plain description>` |

## 3. Content source

| Source | Detail |
|---|---|
| `ChallengeSpec` (seeded generator) | `<spec slugs per band, or none>` |
| Question Studio pool | `<pool for region and chest, or none>` |
| Authored adventure step | `<step id, or none>` |
| Other (requires owner approval) | `<describe, or none>` |

## 4. Correctness rule (owned by application code)

| Field | Value |
|---|---|
| Django function that grades | `<module.function>` |
| Answer representation | `<integer / choice id / ordered list / ...>` |
| Rule in plain words | `<rule>` |
| Snapshot on the attempt | `<fields snapshotted so a republish never regrades>` |
| Tests proving the rule | `<test paths>` |

## 5. Age-band variants

| Age band | Supported? | Parameters (range, operation, choice count) | Response mode | Reading load | Presentation |
|---|---|---|---|---|---|
| Sprouts (3 to 4) | `<yes/no>` | `<parameters>` | `<tap / count>` | `<pictures, narration>` | `<presentation>` |
| Pathfinders (5 to 6) | `<yes/no>` | `<parameters>` | `<mode>` | `<level>` | `<presentation>` |
| Explorers (7 to 8) | `<yes/no>` | `<parameters>` | `<mode>` | `<level>` | `<presentation>` |

## 6. Hints

| Hint level | Authored hint (per band where different) | AI variation allowed? |
|---|---|---|
| `<0..n>` | `<text, readable aloud>` | `<no / yes, via ADR-044 pipeline with this text as fallback>` |

## 7. Feedback

- Correct: `<encouraging text, visual cue, sound cue id>`
- Not yet correct: `<calm text, retry, next hint; no shame>`

## 8. Fallback

| Failure | Fallback |
|---|---|
| Pool empty or too small | `<ChallengeSpec generator>` |
| AI hint unavailable | `<authored hint at the same level>` |
| Grading request fails | `<calm retry message; answer not lost>` |

## 9. Replay variation

`<seeded generation per attempt / pool selection / what never varies>`

## 10. Accessibility

`<input methods, targets, screen reader labels, sound-off path, no timers>`

## 11. Progress written

| Model | Written by |
|---|---|
| `ChallengeAttempt` | `<service>` |
| `SkillEvidence` | `<service>` |

## 12. Acceptance criteria

1. `<criterion>`

## 13. Owner decisions

| Decision needed | Decision and date |
|---|---|
| `<question>` | `<pending>` |

## Checklist

- [ ] Correctness implemented and tested in Django; engine emits events only.
- [ ] Every supported band has its own variant and passes band validation.
- [ ] Authored hints for every level; AI variation optional with authored fallback.
- [ ] Fallback defined for every failure.
- [ ] Gradable content snapshotted on the attempt.
- [ ] No timers or countdowns; retry always possible.
- [ ] AI-generated questions only from published Question Studio revisions.
