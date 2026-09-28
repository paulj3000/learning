# ADR-019 — Decision

ADR-019 is **Accepted**.

Please update `docs/DECISIONS.md` accordingly and proceed with SC-8/SC-9 using the decisions below.

## Part A — Multiple Story Entry Points

**Decision: YES.**

A story arc may be playable from more than one location.

For example, `THE_CASTLES_SECRET_DOOR` may be entered from:

* `StoryPage` / the Adventure Library
* Storykeeper Castle in the 3D world

These are two entry points into the **same story**, not two separate versions of the story.

There must be only one canonical `ChildStoryProgress` for the child/story combination.

A child must be able to:

```text id="a4utbm"
Start in Castle
    ↓
make progress
    ↓
leave
    ↓
open StoryPage
    ↓
continue from the same progress
```

and also:

```text id="qzwc5e"
Start in StoryPage
    ↓
make progress
    ↓
leave
    ↓
enter Castle
    ↓
continue from the same progress
```

Do **not** create separate castle and library progress.

Do **not** run a story's `ADVENTURE` scene as an unrelated standalone adventure merely because the child entered it through the 3D world.

### Product Rule

The Adventure Library is the persistent, location-independent way to find and resume stories.

The 3D world provides contextual ways to discover and play those same stories.

**Stories belong to the Story Engine, not to their entry point.**

---

## Part B — Story Engine Owns Progress

**Decision: ACCEPT AS PROPOSED.**

`useStoryProgress` remains the sole owner of story progression.

The 3D World Engine may present and interact with story content, but it must not independently:

* advance a chapter;
* skip a scene;
* complete a scene;
* complete a chapter;
* grade an answer;
* create story progress;
* duplicate story progress.

Maintain the existing architectural layering:

```text id="g5y9ac"
Three.js World Engine
        ↓
Story Engine
        ↓
Adventure Engine
        ↓
Learning Rules
        ↓
World State
```

The world provides interaction and presentation.

The Story Engine decides story progression.

The Adventure Engine decides challenge progression and validation.

---

## Part C — StoryChapterRunner Renderer Seam

**Decision: ACCEPT AS PROPOSED.**

Add the optional `ADVENTURE` scene renderer seam to `StoryChapterRunner`.

Existing callers should continue using the current default `AdventureRunner`.

A 3D region may provide a custom renderer that owns the appropriate `useAdventureSession` and renders `AdventureStepCard`.

There must still be only **one AdventureSession** representing that adventure attempt.

Do not create region-specific replacements for the Story Engine such as:

```text id="st5tsd"
CastleStoryRunner
ForestStoryRunner
ThreeJsStoryRunner
```

`StoryChapterRunner` remains canonical.

---

## Additional Architectural Rule — Canonical Progress Identity

Add this principle to ADR-019:

> Entry point is presentation metadata, never progression identity. `ChildStoryProgress`, chapter state, adventure sessions, completion state, and resulting world changes must be keyed to the underlying story/chapter/adventure identity and must never be duplicated or namespaced by the route from which the child entered (`StoryPage`, castle, NPC, quest, discovery, or another world interaction).

For example, never create:

```text id="ygc0dg"
castle-secret-door-progress
library-secret-door-progress
```

There is only progress for:

```text id="0d72e2"
THE_CASTLES_SECRET_DOOR
```

---

## Required Resume Testing

Before SC-9 is considered complete, add tests covering entry-point switching.

Test at minimum:

1. Start a story from `StoryPage`.
2. Make partial progress.
3. Leave.
4. Enter the corresponding 3D region.
5. Verify the same progress resumes.

And the reverse:

1. Start the story from the 3D region.
2. Make partial progress.
3. Leave.
4. Open `StoryPage`.
5. Verify the same progress resumes.

Verify that switching entry points does not cause:

* duplicate `ChildStoryProgress`;
* duplicate `AdventureSession` for the same active attempt;
* duplicate story completion;
* duplicate `completionWorldChange`;
* loss of progress;
* replay of already-completed scenes.

---

## Age-Band Gating

The 3D world must enforce the same story eligibility rules as `StoryPage`.

For the current Storykeeper Castle work, the Explorer-only story must remain Explorer-only when entered from the castle.

Reaching a Three.js object must never bypass Story Engine eligibility.

Prefer sharing/reusing the existing eligibility logic rather than implementing separate castle-specific age-band rules.

---

## Authored World Entry Points

Accepting this ADR does **not** mean every story should automatically appear in the 3D world.

A 3D story entry point remains an authored `WorldInteraction`.

Content decides where a story may be discovered.

For example:

```text id="7e5p4p"
THE_CASTLES_SECRET_DOOR

Adventure Library       ✓
Storykeeper Castle      ✓
Relevant NPC            potentially
Welcome Harbor          ✗ unless explicitly authored
Other regions           ✗ unless explicitly authored
```

---

# Implementation Direction

Proceed with ADR-019 as **Accepted**.

Then:

1. Update `docs/DECISIONS.md` and change ADR-019 from `Proposed` to `Accepted`.
2. Incorporate the canonical-progress rule above into ADR-019.
3. Add the cross-entry resume tests before or as part of SC-9.
4. Ensure the castle uses the same Explorer-band eligibility rules as `StoryPage`.
5. Implement the optional `ADVENTURE` renderer seam in `StoryChapterRunner`.
6. Complete SC-8's remaining castle/story integration.
7. Proceed with SC-9 using the shared Story/Adventure Engine architecture.
8. Update `docs/ROADMAP.md` and `docs/IMPLEMENTATION_STATUS.md` as appropriate.

Do not create a parallel castle story/progress system.

The governing principle going forward is:

> **Stories belong to the Story Engine. Adventures belong to the Adventure Engine. The Adventure Library and 3D world are different entry points into the same canonical content and progress.**
