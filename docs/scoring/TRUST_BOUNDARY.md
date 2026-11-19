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

## 3. Restricted and deferred: jumps and courses

`jump.challenge.completed` and `course.completed` (engine contract v1) are known only to the
client. No server record exists for them on any branch (audit of the firepeak, north-pole and
treasure-rush branches). They are classified `DEFERRED`. The fixture policy lists their values
(100 XP and 250 XP), but no collector produces their facts, so they award nothing. A database
constraint also stops any rule from accepting client-reported trust.

To make them authoritative later, one of these is needed, as its own ticket:

1. **Server-bounded:** a published course or challenge record (authored id, area, routes) and an
   intake that accepts one claim per child per authored id. This becomes `SERVER_BOUNDED`, as pickups are.
2. **Server-checked:** the server checks a checkpoint sequence against the authored course.
   This is still bounded: positions are never sent.

Both keep the accessible route equal. The engine contract makes a non-jump completion the same
claim, and `jump.alternative.used` is never valued.

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

## 6. Open risks

- Pickups and client-saved quest completion are bounded, not proven. The Storykeeper branch's
  quest-claim proofs (`claim_is_proven`) would raise quest completion toward GRADED once merged.
  The collector can then read that proof.
- Stars count pickups, so they inherit the pickup boundary.
