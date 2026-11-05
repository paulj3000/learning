# NPC Manager: acceptance coverage and browser checklist (LAI-NPC-040)

Two parts. Part A maps every required acceptance area to the automated tests that cover it (no
browser). Part B is the owner's step-by-step browser checklist: **nothing in Part B has been run
by an agent**. A tick is the owner's result. Live Polly and live Bedrock steps need the owner's
explicit approval before anyone runs them, because they call AWS.

Storykeeper's Castle (Keeper Quill, LAI-NPC-039) is integrated separately. Its rows are marked
**pending castle merge**; the integrator fills in section B13 and the matrix rows after merging.

## Part A. Automated coverage matrix

Commands (from the worktree root; own database `lai_npc_accept`):

```bash
cd lai && POSTGRES_DB=lai_npc_accept LAI_REQUIRE_POSTGRES=1 /Coding/ENV/bin/python -m pytest -q -p no:cacheprovider apps/npcs apps/speech apps/ai
cd react && /Coding/node_modules/.bin/vitest run --maxWorkers=2 src/features/npc-manager src/features/island-map/three/extensions/regionPlay
cd react && /Coding/node_modules/.bin/tsc -b
```

New in LAI-NPC-040 (cross-cutting, full flow):

- `lai/apps/npcs/tests/test_acceptance_flow.py` (Django, 14 tests): the real seeded Pip through
  publish, child runtime read, conversation to `OFFER_QUEST`, republish (open conversation
  `409 conversation_ended`), rollback, retire (`404 no_active_release`) through Django Admin,
  another family 404 at each step, the game cookie (Area yes, Place and catalog 401/403), every
  Treasure Rush trigger, speech refusals with captions kept, hybrid hint with the fake model and
  with AI disabled, the asset retirement guard; no gameplay rows written anywhere in the flow.
- `react/src/features/npc-manager/acceptance/npcManager.acceptance.test.tsx` (Vitest, 1 long
  scenario): the real scene host, runtime, animator, behaviours, dialogue, voice and UI with
  fake API, fake loader and a hand-driven frame clock: load, placeholder on a failing model,
  approach, prompt, interact, caption, muted voice (text only), `OFFER_QUEST`, close returns
  focus, leave hides the prompt, treasure outcome reaction plus line, unmount disposes everything
  (no frame callbacks, roots, timers or window/document/matchMedia listeners left; loader called
  once per model, never per frame).

| Area | Covered by (Django: `lai/apps/...`; React: `react/src/features/...`) |
|---|---|
| NPC authoring (admin) | `npcs/tests/test_admin_characters.py` (roles, create NPC, variants, placements, dialogue, status actions), `test_behavior_preview.py`, `test_ai_persona.py` (persona admin), `test_admin_releases.py` (validate page) |
| Publishing | `npcs/tests/test_foundation.py` (snapshot, invalid refuses, unchanged, one active), `test_admin_releases.py`, `test_treasure_pip_seed.py`, `test_dialogue_validation.py`, `test_voice_validation.py`, `test_behavior_validation.py`, **`test_acceptance_flow.py::test_lifecycle_from_seed_to_retirement`** (publish via admin) |
| Asset resolution | `npcs/tests/test_assets_validation.py`, `test_runtime_api.py` (variant resolution), React `npc-manager/api/npcModelLoader.test.ts`, `engine/npcModelCache.test.ts`, **`test_acceptance_flow.py::test_pips_model_cannot_be_retired_while_a_release_uses_it`** (served `npc-pip` ref) |
| Placement | `npcs/tests/test_foundation.py` (hierarchy), `test_runtime_api.py` (scope split, spawn conditions, age bands), `test_treasure_pip_seed.py` (Pip on the legacy spot), **acceptance flow** (exactly one Pip in the Area) |
| Rendering (fake loader) | React `engine/createNpcRuntime.test.ts`, `engine/npcRuntimePerformance.test.ts`, `host/useNpcSceneHost.test.tsx`, **`acceptance/npcManager.acceptance.test.tsx`** (model shown, placeholder on failure) |
| Animation | React `animation/npcAnimator.test.ts` (map, fallbacks, priority bands, crossfade, placeholder motion), `engine/createNpcRuntime.test.ts`; Django `test_treasure_pip_seed.py` (map limited to model clips) |
| Dialogue | `npcs/tests/test_dialogue_engine.py`, `test_dialogue_api.py`, `test_dialogue_state.py`, `test_dialogue_validation.py`; React `dialogue/*.test.ts`, `ui/NpcDialoguePanel.test.tsx`; **both acceptance files** |
| Sound | React `host/useNpcSceneHost.test.tsx` ("reports the Sound Manager NPC moments"), `voice/useNpcVoice.test.tsx` (mute, volume), `regionPlay/RegionPlayCompanion.npc.test.tsx`; **React acceptance** (muted: no speech request) |
| Movement | React `behavior/behaviorMachine.test.ts`, `collision.test.ts`, `createBehaviorController.test.ts`, `parameters.test.ts`, `isolation.test.ts`, `engine/npcRuntimePerformance.test.ts` (far NPC route); Django `test_behavior_validation.py`, `test_behavior_preview.py` |
| Treasure Rush events | React `dialogue/triggers.test.ts`, `host/triggerQueue.test.ts`, `regionPlay/RegionPlayCompanion.npc.test.tsx` (exactly one Pip, rewards unchanged, calm stop); Django `test_treasure_pip_seed.py`, **`test_acceptance_flow.py`** (every Pip trigger, `on_adventure_complete` only after the world change); **React acceptance** (treasure reaction plus line) |
| Storykeeper's Castle events | **Pending castle merge** (LAI-NPC-039 is not on this branch). Integrator adds the castle tests here. |
| Child authorization | `npcs/tests/test_runtime_api.py`, `test_dialogue_api.py`, `test_ai_hint_api.py` (another family 404, 401, game cookie scope), `speech/tests/test_npc_dialogue_node.py`; **`test_acceptance_flow.py`** (other family 404 at every lifecycle step, cookie Area-only) |
| AI safety | `npcs/tests/test_ai_hint_api.py` (invalid output, boundary violations, guardrail, kill switch, parent switch, rate limit, no free text), `ai/tests/test_npc_hint_contract.py`, `test_ai_persona.py`; **`test_acceptance_flow.py`** (fake model, AI disabled fallback, authored Pip refuses without a model call) |
| Polly fallback | `speech/tests/test_npc_dialogue_node.py` (speech disabled), `speech/tests/test_speech_api.py` (Polly failure 503, not poisoned), `npcs/tests/test_voice_pregenerate.py` (failures never raise); React `voice/npcVoiceCoordinator.test.ts`, `voice/useNpcVoice.test.tsx` (captions always); **`test_acceptance_flow.py::test_speech_disabled_or_a_polly_error_is_a_safe_refusal_and_captions_stay`** |
| Rollback | `npcs/tests/test_foundation.py`, `test_admin_releases.py` (incl. refused after asset retirement); **acceptance flow** (rollback via admin ends open conversations, serves release 1 content) |
| Error handling | `npcs/tests/test_dialogue_api.py` (invalid transitions, 404/409 codes), `test_runtime_api.py` (no release, unknown place/area); React `host/useNpcSceneHost.test.tsx` (empty, failed, calm fallback line, hint refusal keeps the line), `api/npcApi.test.ts`, `contracts/parse.test.ts`; **acceptance flow** (`invalid_trigger`, retired release) |
| Resource cleanup | React `engine/createNpcRuntime.test.ts`, `engine/npcModelCache.test.ts`, `host/useNpcSceneHost.test.tsx` (unmount), `behavior/createBehaviorController.test.ts`; **React acceptance** (no timers, listeners, frame callbacks or roots after unmount; model lease released) |

Not covered automatically (needs the browser, Part B): real WebGL rendering, real GLB clips and
crossfades, frame rate, real touch and screen readers, live Polly, live Bedrock, and how it feels.

Observations from writing these tests (not defects against contract 1.1):

- A hint request with `LAI_AI_PROVIDER=disabled` returns the fallback without writing an
  `AIInteractionAudit` row (the model-call path writes one). The contract does not require an
  audit row for a disabled provider; noted for the AI owner in case parent-facing reporting
  should count fallbacks.

## Part B. Owner browser checklist

Mark each step `[x]` pass or write `FAIL:` with what you saw. Use synthetic test accounts only.

### B1. Environment setup

Ports: PostgreSQL 5442, Django 8010, Vite 5183 (Makefile, `react/vite.config.ts`). Full detail:
`docs/TREASURE_RUSH_LOCAL_DEV.md`.

```bash
make py-install                      # once
make up                              # PostgreSQL 16 on 127.0.0.1:5442
make migrate
cd lai
../.venv/bin/python manage.py load_content
../.venv/bin/python manage.py seed_treasure_rush
../.venv/bin/python manage.py publish_treasure_rush
../.venv/bin/python manage.py ensure_npc_roles
../.venv/bin/python manage.py ensure_asset_roles
../.venv/bin/python manage.py seed_npc_pip --publish
../.venv/bin/python manage.py create_admin_account <you> --superuser   # once; asks for a password
export COGNITO_REGION=... COGNITO_USER_POOL_ID=... COGNITO_ALLOWED_CLIENT_IDS=...
cd .. && make runserver              # http://127.0.0.1:8010
# second shell; react/.env.local has VITE_BACKEND=django
npm run dev                          # http://127.0.0.1:5183
```

Keep `LAI_SPEECH_PROVIDER` unset (disabled) and `LAI_AI_PROVIDER` unset (fake) unless a step
says otherwise.

| # | Action | Expected | Result |
|---|---|---|---|
| 1.1 | Run the commands above | Each finishes without error; `seed_npc_pip --publish` prints "NPC release 1 is ACTIVE" (a rerun prints "unchanged") | [ ] |
| 1.2 | `curl http://127.0.0.1:8010/api/v1/health/` | 200 | [ ] |
| 1.3 | Open `http://127.0.0.1:5183`, sign in as the test parent, create a Pathfinder child | Dashboard lists the child | [ ] |

### B2. Django Admin authoring

Create two staff accounts: one in **NPC editors**, one in **NPC publishers**.

| # | Action | Expected | Result |
|---|---|---|---|
| 2.1 | As the editor open `/admin/npcs/npccharacter/` | Pirate Pip listed (status Ready); search and filters work | [ ] |
| 2.2 | Open Pip: variants, placements, dialogues | Variant `classic` with model `npc-pip` and map Idle/Talk/Wave; placement `cove-pip` in 3D Area `treasure-rush-cove`; twelve dialogues | [ ] |
| 2.3 | Open the `mission-offer` dialogue, change the "ask" node text, save | Saved; nothing changes in the game yet (drafts are never served) | [ ] |
| 2.4 | Try to set a variant animation map clip the model does not have | Refused with a message naming the available clips | [ ] |
| 2.5 | Open the behaviour profile `pip-landing` preview | Plot and parameter summary render; problems (if any) listed | [ ] |
| 2.6 | As the editor open `/admin/npcs/npcrelease/validate/` | Shows the change as ready; no Publish button ("Ask an NPC publisher") | [ ] |

### B3. Validate, publish, roll back, retire, dependency report

| # | Action | Expected | Result |
|---|---|---|---|
| 3.1 | As the publisher open the validate page and publish with a note | "Published NPC release 2"; release 1 shows Superseded | [ ] |
| 3.2 | In the game, talk to Pip | The new "ask" text shows | [ ] |
| 3.3 | Break a dialogue (clear its start node) and validate | Problems listed; publish refused; no new release row | [ ] |
| 3.4 | Restore it. Open release 1, press "Roll back to this release" | "NPC release 1 rolled back."; the game shows the original text after re-entering the cove | [ ] |
| 3.5 | With Pip's panel open in the game, roll back or publish in the admin, then press a choice | The panel shows the calm fallback line or closes; no error screen; talking again shows the new release | [ ] |
| 3.6 | Open `/admin/npcs/npcrelease/dependencies/` | `npc-pip` listed as used by the active release | [ ] |
| 3.7 | In the asset library try to retire `npc-pip` | Refused: "used by NPC release(s) ..." | [ ] |
| 3.8 | Retire the active release | "children see no NPCs"; see B5 for what the game does | [ ] |
| 3.9 | Try to roll back to the retired release | "A retired release never comes back" | [ ] |
| 3.10 | Re-publish (or roll back to another superseded release) for the next sections | One ACTIVE release again | [ ] |

### B4. Treasure Rush with managed Pip

Open `/island/<childId>/explore/treasure-rush-cove` as a new child.

| # | Action | Expected | Result |
|---|---|---|---|
| 4.1 | Arrive | Exactly one Pip at his camp at Pirate Landing; he greets you once (first visit) | [ ] |
| 4.2 | Walk up | "Talk to Pirate Pip" prompt appears; it goes when you walk away | [ ] |
| 4.3 | Tap the prompt (also try tapping Pip, and the "Things to do here" list) | The same conversation opens: Pip asks for help with "Yes, I will help!" and "Maybe later" | [ ] |
| 4.4 | Choose "Maybe later" | Panel closes; no quest started | [ ] |
| 4.5 | Talk again, choose "Yes, I will help!" | Pip's Missing Treasure starts through the normal accept flow; HUD "0 of 4"; offered once | [ ] |
| 4.6 | Open the first chest, answer wrong | Chest panel first; after you close it Pip says one hint line ("Not quite...") | [ ] |
| 4.7 | Answer right | Reward reveal first; then Pip reacts (celebrate) and says "Arr, you found treasure!" | [ ] |
| 4.8 | Talk to Pip mid-quest | "The treasure is waiting for you." then where to look | [ ] |
| 4.9 | Finish all four and return to Pip | Finale once, Explorer Badge, then Pip's completion lines; the bridge message after | [ ] |
| 4.10 | Check the backpack and HUD | Rewards exactly as without the NPC Manager; nothing twice | [ ] |
| 4.11 | Exit mid-quest, reload, come back | Progress kept (save/resume); Pip says "Ahoy again, friend! Welcome back" instead of the first greeting | [ ] |
| 4.12 | Let the session time limit end the visit (calm stop) | Pip does not celebrate a time-out | [ ] |
| 4.13 | Throughout | Never two Pips; Pip's lines never cover a chest panel or reward reveal | [ ] |

### B5. Fallback to legacy Pip

| # | Action | Expected | Result |
|---|---|---|---|
| 5.1 | Retire the active release (B3.8), re-enter the cove | The legacy Pip and his old panel are back; the adventure works end to end | [ ] |
| 5.2 | Stop Django mid-visit, re-enter | No error screen; legacy Pip (or the app's offline message for the whole region) | [ ] |
| 5.3 | Make Pip's model fail (e.g. block `/api/v1/asset-files/` in dev tools) and re-enter | A placeholder block stands where Pip is; you can still talk to him | [ ] |
| 5.4 | Restore a release | Managed Pip returns on the next visit | [ ] |

### B6. Behaviours and animation

| # | Action | Expected | Result |
|---|---|---|---|
| 6.1 | Walk around Pip | He turns to face you smoothly (stationary, `facePlayer`) | [ ] |
| 6.2 | Talk | He stops, faces you, waves or talks per line; returns to idle after | [ ] |
| 6.3 | Get a treasure | One celebrate reaction, then back to idle; no stuck animation | [ ] |
| 6.4 | (Optional) Change `pip-landing` to `wander` with a small radius, publish, re-enter | Pip wanders inside the radius, avoids walls, stops to talk, resumes after | [ ] |
| 6.5 | Watch for 2 minutes | No jitter, sliding feet beyond the model's own, or popping between clips | [ ] |

### B7. Voice

| # | Action | Expected | Result |
|---|---|---|---|
| 7.1 | Speech disabled (default): talk to Pip | Captions show for every line; no "Hear it again"; no console errors beyond one notice | [ ] |
| 7.2 | `LAI_SPEECH_PROVIDER=fake`, create a VoiceProfile `pirate-pip` (Justin, neural, en-US) and attach it to Pip, publish | Lines show captions; requests to `/audio/speech/` answer 200 (fake audio does not play real sound) | [ ] |
| 7.3 | **Owner approval required:** `LAI_SPEECH_PROVIDER=polly` with AWS credentials | Pip speaks each line; "Hear it again" replays; closing the panel stops the voice; captions always visible | [ ] |
| 7.4 | Mute the master or voice channel | Text only, no request, no "Hear it again"; unmute brings it back | [ ] |

### B8. AI hint

| # | Action | Expected | Result |
|---|---|---|---|
| 8.1 | On a fresh database run `seed_npc_pip --hybrid-hints --publish` (or switch Pip to Hybrid in admin with an approved persona) | Release active; persona v1 approved | [ ] |
| 8.2 | Answer a chest wrong, choose "Help me" (fake provider) | A short counting hint replaces the line; never the answer | [ ] |
| 8.3 | `LAI_AI_PROVIDER=disabled`, repeat | One of the persona's fallback lines; no error | [ ] |
| 8.4 | Turn the child's AI setting off in the parent dashboard, repeat | Fallback line; no model call | [ ] |
| 8.5 | **Owner approval required:** `LAI_AI_PROVIDER=bedrock` | A safe, short, on-topic hint; Django Admin shows an audit row with no child text | [ ] |

### B9. Accessibility

| # | Action | Expected | Result |
|---|---|---|---|
| 9.1 | Keyboard: Tab to the prompt, Enter or Space | Panel opens; focus on the first button; Tab cycles inside; Escape closes; focus back on "Talk to Pirate Pip" | [ ] |
| 9.2 | Touch (tablet) | Prompt and buttons are large (56 px); one tap acts | [ ] |
| 9.3 | Screen reader (VoiceOver or TalkBack) | Dialog announced with Pip's name; each line read once, prefixed by the speaker; choices read as buttons | [ ] |
| 9.4 | Reduced motion on in the OS, during play | Pip snaps to face you, no hop; UI transitions off | [ ] |
| 9.5 | Mute (B7.4) | Text only | [ ] |
| 9.6 | Copy | No em dashes; calm wording; readable aloud | [ ] |

### B10. Performance spot-checks

| # | Action | Expected | Result |
|---|---|---|---|
| 10.1 | On the reference tablet, open the cove, watch the frame rate for a minute | Smooth; record fps: ____ | [ ] |
| 10.2 | Dev tools Network: walk around for a minute | `npc-pip` model fetched once; no per-frame requests | [ ] |
| 10.3 | Leave and re-enter the cove five times | No growing memory in the Performance monitor; no duplicate Pips | [ ] |
| 10.4 | Profile one frame | NPC engine update under 1 ms (`docs/NPC_MANAGER_PERFORMANCE.md`) | [ ] |

### B11. Authorization spot-check (optional, curl)

| # | Action | Expected | Result |
|---|---|---|---|
| 11.1 | With a second test parent's token, GET `/api/v1/children/<first child>/regions/treasure-rush-cove/npcs/` | 404 | [ ] |
| 11.2 | Without a token | 401 | [ ] |

### B12. Record results

Write the results, the date, the device and anything surprising in
`docs/IMPLEMENTATION_STATUS.md` under LAI-NPC-040.

### B13. Storykeeper's Castle with Keeper Quill (PENDING CASTLE MERGE)

> Placeholder. The integrator fills this section in after merging LAI-NPC-039 (Keeper Quill) into
> the integration branch: setup commands (seed and publish Quill), Quill's placement and
> greeting, castle triggers and story events, the castle fallback when no release is active,
> voice and captions, accessibility, and the matching rows in the Part A matrix
> ("Storykeeper's Castle events") with the castle test files.

| # | Action | Expected | Result |
|---|---|---|---|
| 13.1 | _to be written after the castle merge_ | | [ ] |
