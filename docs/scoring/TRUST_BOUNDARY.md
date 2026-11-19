# Scoring Trust Boundary (GE-104)

- **Status:** Development documentation for GE-100. Describes code on `core/ge-scoring`.
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [`lai/apps/scoring/collectors.py`](../../lai/apps/scoring/collectors.py), [`lai/apps/scoring/contracts.py`](../../lai/apps/scoring/contracts.py) (`Trust`), [`lai/apps/scoring/engine_events.py`](../../lai/apps/scoring/engine_events.py)

The client never determines an award. This page says, for every source, what the server
itself established, and what is restricted or deferred because it cannot.

## 1. What the server establishes today (audited 2026-11-18)

| Gameplay | Server route | What Django checks | Scoring trust |
|---|---|---|---|
| Step answer | `submit_answer` | grades the answer with the adventure engine; idempotent per request id | GRADED |
| Chest challenge (incl. Question Studio items) | `submit_chest_answer` | grades against the issued attempt | GRADED |
| Area puzzle, graded kinds | `solve_puzzle` | grades the submission against the pinned revision | GRADED |
| Area puzzle, COLLECT_OBJECT / RETURN_TO_NPC | `solve_puzzle` | stage order and publication; accepts "done" (`_no_answer`) | BOUNDED |
| Step adventure completion | `submit_answer` only | reached through graded steps | GRADED |
| Secret discovery | `record_discovery` | the discovery's requirements | GRADED |
| Mastery milestone | derived from graded evidence | shared mastery thresholds | GRADED |
| First visit to a 3D Area | `start_or_resume_region_session` | the area is published | BOUNDED |
| Pickup (coin, shell, shard) | `collect_pickup` | the placement exists in the session's area, once; **no proximity check** | BOUNDED |
| Quest completion | quest refresh or the quest state route | the refresh checks real state; the state route checks ids and order only | BOUNDED |
| Reward rule granted | the routes above | once per child (`GrantedRule`) | BOUNDED |

`SERVER_BOUNDED` means the child's claim is accepted, but only for an authored, published
thing, once per child, from a finite set. The most a forged request can do is earn an
already-authored award early, which costs another child nothing.

## 2. What is not a source, and why

| Record | Why it is ignored |
|---|---|
| A bare `WorldChange` | `POST world-changes/` accepts any well-formed key and type, including `UNLOCK` or `COLLECTIBLE_FOUND`. Chests and puzzles are read from their attempts. A pickup counts only if its key belongs to an authored placement. |
| A REGION session marked COMPLETED | The client may complete a region session. |
| A REPLAY chest | Practice only (TR-20). |
| A story reflection | Participation evidence, not a graded answer. |
| `SeasonalCompletion` (North Pole branch) | Its trigger is a world change the client can post. The yearly key also needs an owner decision. |

## 3. Jumps and courses (reviewed for GE-109, 2026-11-19)

| Source | Server-owned record? | Decision |
|---|---|---|
| Individual jumps, jump challenges (`jump.challenge.*`), optional jump-only challenges (engine decision E16) | **None.** Engine bus only; no route, section or landing is recorded | **Deferred.** No award. Optional jump routes that end in a pickup are already paid as that pickup (and as a secret when the item is hidden), so the route itself never needs paying |
| Course checkpoints (`course.checkpoint.reached`) | Only `WorldState.last_checkpoint_id` (a resume position from `PATCH world-state`, filtered to authored ids) | **Never a source.** A resume position is not an achievement |
| Course completion (`course.completed`) | **Yes, where the course ends in a graded challenge.** Pirate's Leap ends at the crow's nest chest, whose server-graded answer completes quest `pirates-leap` | **Awarded, SERVER_BOUNDED,** from the quest *and* the chest's correct attempt (`realms.py`). Route-independent: the walking route reaches the same chest. The claim itself is still ignored |

So nothing is awarded on client-reported movement. A course counts only through a learning
challenge the server graded at its goal. A course without such an end (none today) stays
deferred. Making jumps themselves authoritative would need a new server record (an authored
challenge registry plus a once-per-child claim intake, or server-side checkpoint-sequence checks).
That is a new architecture and product decision, so it is not built (options in section 7).

## 4. Why there is no claim-intake route yet

Every `SERVER_RECORD` claim is already written by its own play route, so an intake would add
nothing for those. Storing `DEFERRED` claims would be a new kind of child data (a per-child log
of client gameplay claims). That needs a retention and privacy decision first. The React
adapter uses claims only to show a **pending** notification, with no amount, which the awards
feed then confirms or quietly drops.

## 5. Development playground

Activity in any scope whose id starts with `playground`, `dev-`, `test-` or `engine-playground`
(plus `LAI_SCORING_EXCLUDED_SCOPE_PREFIXES`) produces no facts, so it never earns real awards.
Separately, provisional fixture values award only where `LAI_SCORING_ALLOW_UNAPPROVED` is set,
and production settings refuse it.

## 6. Concurrency, replay, ownership and privacy (reviewed for GE-109)

- **Concurrency:** tested on real parallel PostgreSQL transactions (`test_concurrency.py`).
  Covered: four simultaneous reconciles, four simultaneous writes of one award, and a backfill
  racing live play. Each records every award once, and the projection equals the ledger. The
  unique (child, key) constraint decides, and the projection row lock serialises the totals.
- **Replay:** every key is built from a stable authored source, so replays, retries, backfills
  and new policy versions find the existing key (tests in `test_collectors_and_reconcile.py`).
- **Ownership:** every collector reads `for_child(child)`, and the API resolves the child through
  the parent (404 otherwise). A ledger row cannot link another child's session.
- **Privacy:** ledger rows hold content ids and amounts only, and are not on the Django admin.
  Logs carry counts and exception types. A parent's `DELETE scoring/` erases the scoring record.
  Because awards are derived, a later reconcile re-derives them from the progress that remains.
  To remove that progress, the parent deletes the backpack, the world state or the child profile
  (cascade).

## 7. Options for authoritative jumps (owner decision; not built)

1. **Authored jump challenges with a bounded intake.** Django holds a published registry
   (challenge id, area, routes) and a `POST` that records one claim per child per challenge,
   accepted only in an open session of that area. This would be SERVER_BOUNDED, like pickups.
   It needs a model, a route and content work.
2. **Checkpoint sequences.** The server checks an ordered set of authored checkpoint claims
   against the course. Positions are still never sent. It is still bounded, at more cost than
   option 1.
3. **Keep deferring** (current). Movement earns through what it reaches: pickups, secrets, and
   chests at the goal.

## 8. Open risks

- Pickups and client-saved quest completion are bounded, not proven. The Storykeeper branch's
  quest-claim proofs (`claim_is_proven`) would raise quest completion toward GRADED once merged.
  The collector can then read that proof.
- Stars count pickups, so they inherit the pickup boundary.
