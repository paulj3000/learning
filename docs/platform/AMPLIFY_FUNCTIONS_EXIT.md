# Amplify functions and AI runtime exit (AMP-05)

Status: code complete on the branch, **nothing deployed**. Closes gaps G6 and G7 and the Django
half of G11 in `docs/platform/AMPLIFY_EXIT_MATRIX.md`. Section 5 lists what the owner must
approve, deploy or decide.

**Read this first.** After this change the React code paths below call Django only. On a build
without `VITE_BACKEND=django` (today's hosted `main`, `docs/platform/AMPLIFY_HOSTING.md`) they
degrade safely, without any network call: companion and tutor turns use the code-authored
fallback lines, the Director shows no suggestion, and starting a co-op session fails with a
calm message. Merge this to `main` only together with, or after, the cutover that sets
`VITE_BACKEND=django` (AMP-06), or accept that degradation for the interval.

## 1. Feature-by-feature evidence

| Amplify function or route | Django replacement | React caller | Tests |
|---|---|---|---|
| `get-next-learning-activity` Lambda (`getNextLearningActivity` query) | `GET children/<id>/next-learning-activity/` (`lai/apps/education/views.py`), service `lai/apps/education/director.py` | `react/src/features/director/api.ts` (`fetchNextLearningActivity`, Django client) | `lai/apps/education/tests/test_director.py` (16); `react/src/features/director/api.test.ts` (8) |
| `claim-coop-slot` Lambda (`claimCoopSlot` mutation) | `POST children/<id>/coop-sessions/<coopId>/slots/` (`lai/apps/game_sessions/coop_views.py`), service `coop.claim_slot` | `react/src/features/coop/api.ts` `claimCoopSlot` | `lai/apps/game_sessions/tests/test_coop_api.py` (18, including a real two-thread race); `react/src/features/coop/api.test.ts` (10) |
| Amplify `CoopSession` model create, get, update (presence, complete) | `POST children/<id>/coop-sessions/`, `GET .../<coopId>/`, `POST .../presence/`, `POST .../complete/` | `coop/api.ts` `startCoopSession`, `getCoopSession`, `setCoopPresence`, `completeCoopSession` | same files |
| AppSync `CoopSession.onUpdate` subscription | Polling `GET .../<coopId>/` every 2 s, one request at a time, stopped on unmount | `coop/api.ts` `subscribeToCoopSession`, `coop/useCoopPresence.ts` | `coop/api.test.ts` (poll, stop, error and late-response cases) |
| `submit-adventure-answer` Lambda | `POST children/<id>/sessions/<id>/answers/` (`AnswersView`), unchanged | `react/src/features/adventures/api.ts` (not changed here; AMP-03) | `lai/apps/game_sessions/tests/test_answers_api.py` (32 passed) |
| `operational-metrics` Lambda (DynamoDB streams to EMF) | `ai.turn v1` and new `ai.safety v1` log lines, metric filters and alarms in `LaiAiGuardrail` | none (server-side) | `lai/apps/ai/tests/test_companion_api.py` (3 new); `infra/lib/aiGuardrailStack.test.ts` (11, 3 new); `infra/lib/djangoDeployment.test.ts` (1 new) |
| AI Kit `generateCompanionTurn` | `POST children/<id>/ai/companion-turns/` (LAI-0706, unchanged) | `companion/api.ts`: Amplify branch, browser audit and SafetyEvent writes removed | `companion/api.test.ts` (3), `companion/djangoCompanion.test.ts` |
| AI Kit `generateTutorTurn` | `POST children/<id>/ai/tutor-turns/` (LAI-0706, unchanged) | `tutor/api.ts`: Amplify branch, browser mastery and quest reads, audit writes removed | `tutor/api.test.ts` (4), `tutor/djangoTutor.test.ts` |
| Amazon Polly | `lai/apps/speech/polly.py` (boto3 on the Django role), `POST children/<id>/audio/speech/` | `react/src/api/speech/speechApi.ts` | existing `lai/apps/speech/tests` |
| Amazon Bedrock | `lai/apps/ai/providers/bedrock.py` (Converse with the Guardrail), IAM in `LaiAiGuardrail` | `react/src/api/ai/djangoAi.ts` | existing `lai/apps/ai/tests` |

### Director port

`director.py` ports the Lambda and the pure modules it ran (`director/{select,needs,
reachability}.ts`, `worlds/travel.ts`, `mastery/summary.ts`) with the same constants
(need weights 3/2/1, completed penalty 4, recent penalty 3 over the last 3 sessions, top 3,
title tie-break) and the same flattened wire shape, so `explain.ts` and `ChildDashboard.tsx` are
unchanged. Data now comes from the canonical apps (CLAUDE.md section 20): catalog `Adventure`
and `AdventureStep.objective_ids`, `World.source.travelRequirement`, `WorldChange`,
`AdventureSession` and `SkillProgress` through `education.mastery`. No new model. The
curriculum's skill-to-band map is a small mirror pinned to `content/exported/curriculum.json`
by a test. One deliberate difference: inactive catalog adventures and worlds are never
suggested (Django's `active` flag did not exist on Amplify).

### Co-op: Django polling, not the room server

ADR-026 says the room server exists because continuous movement cannot be a database write per
update, and that `CoopSession` "suits discrete co-op actions". Co-op here is a few slot claims
and join/leave flags per adventure (ADR-006 excludes continuous presence), so the Django routes
plus a 2-second poll are the replacement the ADRs support. The room server is untouched.
Owner confirmation of this reading is listed in section 5.

Rules kept from the Lambda: household only (the parent hosts, both children are theirs), two
different children whose band the adventure supports, first claim wins under a row lock
(`select_for_update`, the PostgreSQL equivalent of the DynamoDB conditional write), a repeat
claim is idempotent, a slot the partner holds is returned as state rather than an error,
completion is idempotent. New: a slot must be a co-op-eligible step (`NUMBER_INPUT`,
`ORDERING`, `MATCHING`, `WORLD_CHANGE`) of the session's adventure, and the parent id never
crosses the wire. Every route is child-scoped (`ChildScopedAPIView`); a session another family
hosts, or one this child is not in, is the same 404 as an unknown id.

## 2. Metrics, alarms and budget (G11, Django half)

| Amplify (`amplify/backend.ts`) | Django replacement (`infra/lib/aiGuardrailStack.ts`) |
|---|---|
| `SafetyEventCount` by severity (EMF from the SafetyEvent stream) | `ai.safety v1 <route> <severity> <source> <ok\|failed>` per SafetyEvent (`auditing.emit_safety_metric`); filters `SafetyEvents`, `HighSeveritySafetyEvents` |
| `HighSeveritySafetyEventAlarm` (1 in 5 min) | `lai-django-ai-<env>-high-severity-safety-event` (1 in 5 min) |
| `AIValidationFailureCount`, `AiValidationFailureAlarm` (5 in 15 min) | filter `ValidationFailures` (`ai.turn` status `INVALID*`); alarm `lai-django-ai-<env>-validation-failures` (5 in 15 min) |
| `AIFallbackUsedCount`, `AILatencyMs`, `AIInteractionCount`, disposition counts | already on Django since LAI-0708 (`Fallbacks`, `LatencyMs`, `Turns`, fallback-rate and latency alarms) |
| AppSync 5xx alarm | `lai-django-<env>-target5xx` on the load balancer (already in `LaiDjangoEc2`) |
| AppSync 4xx alarm | not replaced on purpose: Django answers expected 401/404s (tenant isolation) that would make a 4xx alarm noise |
| `BedrockMonthlyCostBudget` ($50, Service `Amazon Bedrock`) | `lai-bedrock-monthly-<env>` in `LaiAiGuardrail` (default $50, `monthlyBedrockBudgetUsd`), notifying `lai-django-alarms-<env>`, which now trusts `budgets.amazonaws.com` from this account (`LaiDjangoEc2` topic policy) |
| `OperationalDashboard` | not replaced in this card (dashboards are AMP-08) |

The metric lines carry closed vocabulary only: no child, parent or session id, no category text,
nothing a child wrote (tests assert it). The budget caveat in `docs/AI_SERVICE.md` still applies:
Claude usage may bill under AWS Marketplace and not under `Amazon Bedrock`.

## 3. IAM

No IAM is added or removed for the replaced functions. The Lambdas' own roles (DynamoDB reads
and the conditional write) have no Django counterpart because Django uses its own PostgreSQL.
Bedrock and Guardrail access is the existing `lai-django-ai-<env>` managed policy. Polly's
policy (`polly:SynthesizeSpeech` plus the speech bucket) is documented in
`docs/audio/AMAZON_POLLY_INTEGRATION.md` section 10 and is not yet in CDK; it is independent of
Amplify and stays with SM-P8-LIVE.

## 4. What is not removed

`amplify/` (the four function folders, `backend.ts`, AI Kit routes, personas), `react/src/lib/
data-client.ts` and the deployed Amplify resources are untouched; AMP-08 removes them after
cutover. `amplify/data/chattyPersona.ts` and `tutorPersona.ts` are no longer imported by React;
`lai/apps/ai/tests/test_prompts.py` still reads them. Independent Bedrock, Polly and CDK
functionality is unchanged.

Polly and Bedrock verification: no React file imports Polly, Bedrock or an Amplify AI route
after this change (`grep` for `generations.`, `generateCompanionTurn`, `aws-amplify` in
`companion/api.ts`, `tutor/api.ts`, `director/api.ts`, `coop/api.ts` finds nothing; the two AI
modules have a test asserting it). Django calls Polly and Bedrock with boto3 on its own role;
nothing in `lai/` imports or calls Amplify (the word appears only in comments and in migration
help text describing imported data).

## 5. Owner actions

| # | Action | Kind |
|---|---|---|
| 1 | Merge ordering: merge with or after the `VITE_BACKEND=django` cutover (AMP-06), or accept that the hosted Amplify-only build loses AI turns (authored fallback), Director suggestions and co-op until then | decision |
| 2 | Confirm the co-op reading of ADR-026 (Django polling for discrete co-op, room server for continuous play) | decision |
| 3 | `cdk diff` then deploy `LaiDjangoEc2-<env>` (adds one SNS topic-policy statement) before `LaiAiGuardrail-<env>` (adds 5 metric filters, 2 alarms, 1 budget) | APPROVAL, deploy |
| 4 | After deploy, trigger one REDIRECT or STOP turn in dev and confirm `HighSeveritySafetyEvents` or `SafetyEvents` receives a data point; check that the filter pattern `status="INVALID*"` matches with `aws logs test-metric-filter` on a sample `ai.turn` line | live check |
| 5 | Decide whether two Bedrock budgets (Amplify and Django) may coexist until AMP-08, and confirm in Cost Explorer which service Claude spend bills under | decision |
| 6 | If co-op rows exist in the Amplify `CoopSession` table, they need the AMP-08 importer (participants become `CoopParticipant` rows; `sharedState` is read defensively, AWSJSON strings included) | data, AMP-08 |
| 7 | AMP-08: delete the four Lambdas, the AI Kit routes, `OperationalAlertsTopic`, the Amplify alarms, dashboard and budget | APPROVAL, later |
