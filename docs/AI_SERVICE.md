# Django AI Service (Phase 7: LAI-0306, LAI-0701 to LAI-0710)

Status (2026-11-01, branch `features/ai`, unmerged, not pushed): **implemented and verified
locally with the fake model; not live-accepted.** No Bedrock call has been made, nothing is
deployed, and the deployed React build still uses the Amplify routes. React switches to Django
only in a build with `VITE_BACKEND=django`. Section 10 has the per-task status matrix.

Decision: ADR-044 (builds on ADR-019 sub-decision 9). Safety principles:
`docs/AI_AND_CHILD_SAFETY.md`. Code: `lai/apps/ai/`. Infrastructure:
`infra/lib/aiGuardrailStack.ts`.

## 1. What it replaces

| Amplify (still deployed, unchanged) | Django (this phase) |
|---|---|
| `generateCompanionTurn` AppSync generation route | `POST /api/v1/children/{child_id}/ai/companion-turns/` |
| `generateTutorTurn` AppSync generation route | `POST /api/v1/children/{child_id}/ai/tutor-turns/` |
| Browser validates, falls back, writes `AIInteractionAudit` / `SafetyEvent` | Django validates, falls back, writes both, server-side |
| `amplify/data/chattyPersona.ts`, `tutorPersona.ts` | `lai/apps/ai/prompts/` (verbatim copies, same versions, drift-tested) |
| `react/src/features/{companion,tutor}/schema.ts` | `lai/apps/ai/contracts.py` (golden-vector parity) |

Nothing under `amplify/` or `react/` changed behaviour. The Amplify routes keep their IAM grant
and AppSync authorization until LAI-0710.

## 2. Endpoints

All are child-scoped (`ChildScopedAPIView`, LAI-0403): Cognito bearer token, the child resolved
through the authenticated parent, another family's child or an unknown id is the same 404.

| Method and route | Purpose |
|---|---|
| `POST /api/v1/children/{id}/ai/companion-turns/` | Chatty narration, questions, hints, celebrations, NPC voicing |
| `POST /api/v1/children/{id}/ai/tutor-turns/` | Hint-ladder tutoring for one skill |
| `GET /api/v1/children/{id}/ai/safety-events/` | Parent dashboard: this child's safety events, metadata only, newest 100 |
| `DELETE /api/v1/children/{id}/ai/history/` | Parent control: delete this child's AI audit rows and safety events (nothing else) |

### Companion turn

```
POST /api/v1/children/{child_id}/ai/companion-turns/
{
  "intent": "NARRATE" | "ASK" | "HINT" | "CELEBRATE" | "REDIRECT",
  "contextSource": "CLIENT_AUTHORED" (default) | "DJANGO_SESSION",
  "templateId": "repair-the-moonlight-bridge",   // required for CLIENT_AUTHORED (slug, npc:<id>, story:<id>)
  "stepSummary": "counting missing bridge planks", // required for CLIENT_AUTHORED, <= 300
  "authoredBaseText": "...",                    // optional, <= 500
  "learningObjectiveCode": "counting-sets",     // optional
  "hintLevel": 0..5,                            // optional
  "allowedChoiceIds": ["knight", "wizard"],     // optional, <= 6
  "sessionId": "...", "stepId": "..."           // required for DJANGO_SESSION
}
200 {"turn": {"spokenText", "emotion", "intent", "choices"?, "safetyDisposition"},
     "source": "AI" | "FALLBACK", "requestId": "..."}
```

### Tutor turn

```
POST /api/v1/children/{child_id}/ai/tutor-turns/
{
  "skillId": "counting-sets",
  "contextSource": "CLIENT_AUTHORED" | "DJANGO_SESSION",
  "templateId": "...", "hintLevel": 0..5,       // required for CLIENT_AUTHORED
  "authoredBaseText": "...",                    // optional
  "sessionId": "...", "stepId": "..."           // required for DJANGO_SESSION
}
200 {"turn": {"spokenText", "strategy", "representation"?, "emotion", "safetyDisposition"},
     "source": "AI" | "FALLBACK", "requestId": "..."}
```

`turn` and `source` are exactly the `CompanionTurnResult` and `TutorTurnResult` shapes the React
client renders. A turn is always safe to render: every provider failure, invalid output,
Guardrail block, screened input and rate limit is a 200 with authored content. Errors are only for
the request: 400 `validation_error` (also a DJANGO_SESSION `skillId` the step does not teach),
401/403 authentication, 404 `not_found`.

**Ignored body fields** (tested): `childProfileId`, `ageBand`, `maxLength`, `aiEnabled`,
`systemPrompt`, `strategy`, `modelId`, `validationStatus`, `safetyDisposition`. The child, its age
band (and so the length limit) and its AI switch come from Django; the strategy from the hint
ladder; prompts, limits and audit values from code.

### Context sources

Three sources, recorded on every audit row (`context_source`):

- **DJANGO_CATALOG** (companion, `NARRATE` only; LAI-0709): the body carries only `npcId` and
  `nodeId`. Django reads the node's authored `narration` (topic and fallback text) from the
  active `NpcDefinition`; nothing from the browser reaches the model. An inactive NPC or a node
  without a narration hint is 404.
- **DJANGO_SESSION**: the session is one of this child's Django adventure sessions (looked up
  `for_child`; a sibling's session is 404). Django reads the template id, the step's objective,
  the hint level the server gave (`AdventureSession.hint_levels`) and the authored hint text
  (`engine.hint_text`), and ignores client values for them. `allowedChoiceIds` are intersected
  with the step's own option ids. The step's answer (`correctValue`, `correctOptionId`) is never
  read into a prompt.
- **CLIENT_AUTHORED**: the compatibility path for sessions that do not run on Django yet
  (Amplify-era adventures, NPC dialogue, story scenes). The free-text fields are bounded,
  screened (section 3, step 2) and sent to the model as untrusted `guardContent`.
  `sessionId`/`stepId` are opaque correlation strings, never looked up.

The tutor additionally reads, from Django: known prerequisite **titles** (from
`SkillProgress.recent_level` in PROFICIENT/MASTERED; never statuses or counts) and the active
quest's authored title and stage heading. `recent_level` is not yet computed server-side
(LAI-0603), so known prerequisites are usually empty today, which only narrows the prompt.

## 3. Pipeline order (`lai/apps/ai/services/pipeline.py`)

1. Parent switch (`ChildProfile.ai_enabled`) or `LAI_AI_PROVIDER=disabled`: authored content,
   no model call, no audit row (Amplify behaviour). Untutorable skill: the same.
2. Input screen on client text (`services/safety.py`): prompt injection, personal or contact
   information, links, secrecy, gameplay manipulation (award coins, mark mastered, unlock). A hit
   is `BLOCKED_INPUT`, a SafetyEvent (INPUT, `BLOCKED_BEFORE_MODEL`), and a generic line that
   does not echo the text. Violence or scary words are left to the Guardrail on purpose.
3. Shared limits and the runtime kill switch (`services/usage.py`, section 5): `RATE_LIMITED`,
   with failure category `KILL_SWITCH` or `RATE_LIMIT_UNAVAILABLE` when that was the cause.
4. Provider from settings; a misconfiguration fails closed (`ERROR`/`CONFIGURATION`).
5. Model call. Timeout, throttle, access denied, unavailable: `ERROR` with that category.
   Unparseable reply: `INVALID_SCHEMA`.
6. Guardrail intervened: `BLOCKED_GUARDRAIL`, the redirect line, a SafetyEvent (SYSTEM).
7. Contract validation (exact ports of the TypeScript validators): `INVALID_CONTENT`.
8. Django output policy (`content_safety.boundary_violations`): secrecy, dependency, claims of
   humanity or loneliness, impersonation, diagnosis or discipline, contact details, and learning
   judgments (now on the companion too): `INVALID_CONTENT` plus a SafetyEvent (OUTPUT).
9. Model disposition REDIRECT/STOP: the redirect line, a SafetyEvent (OUTPUT, HIGH for STOP),
   category as in Amplify (`companion-turn-hint`, `tutor-turn-give_hint`).
10. Otherwise the validated turn, `source: "AI"`.

Steps 2 to 10 always write one `AIInteractionAudit` row and one `ai.turn` log line. Validated
turns contain only contract fields: a model that returns `reward`, `masteryStatus` or `nextStepId`
has those dropped, and the endpoints write nothing except `ai_*` rows (tested by capturing every
SQL write).

## 4. Bedrock

`lai/apps/ai/providers/bedrock.py`, boto3 `bedrock-runtime` **Converse**:

- **Model**: `us.anthropic.claude-haiku-4-5-20251001-v1:0` (US geographic inference profile).
  Claude Haiku 4.5 has no in-Region on-demand model id on `bedrock-runtime`. From source Region
  `us-west-1` the profile routes to us-east-1, us-east-2, us-west-1 and us-west-2 (Bedrock model
  card, read 2026-11-01). The Amplify routes use the `global.` profile; Django uses the US one.
  Same limits as Amplify: temperature 0.4, 300 output tokens.
- **Structured output as text, never tool use.** Guardrails do not evaluate `toolUse.input` on
  Converse, so a tool-returned turn would bypass the output Guardrail. Django uses
  `outputConfig.textFormat` (JSON schema, every object `additionalProperties: false`), which
  returns a text block the Guardrail does evaluate. `LAI_AI_STRUCTURED_OUTPUT=false` falls back to
  prompt-instructed JSON. The first call with a new schema can take up to about 90 s to compile
  (then cached 24 h); with the 10 s timeout that first call falls back. Warm it once after deploy.
- **Untrusted text** goes in `guardContent` blocks (the Converse equivalent of input tagging, which
  prompt-attack detection needs). The system prompt is not wrapped.
- **Guardrail trace off.** A trace holds the matched PII and the pre-masking text. Every
  `guardrail_intervened` is treated as a block, so the Guardrail's PII action must be BLOCK.
- **Credentials**: the default boto3 chain (the EC2 instance role). None in settings.
- **Errors**: mapped to a closed `FailureCategory`; AWS messages are dropped, never logged.

## 5. Configuration

| Setting | Default | Notes |
|---|---|---|
| `LAI_AI_PROVIDER` | `fake` (local/test), `disabled` (production) | `fake`, `bedrock`, `disabled`. Production refuses `fake` |
| `LAI_AI_BEDROCK_REGION` | empty | required for `bedrock` (us-west-1) |
| `LAI_AI_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | required in production |
| `LAI_AI_GUARDRAIL_ID`, `LAI_AI_GUARDRAIL_VERSION` | empty | required for `bedrock`; production refuses `DRAFT` |
| `LAI_AI_STRUCTURED_OUTPUT` | `true` | |
| `LAI_AI_MAX_OUTPUT_TOKENS` | 300 | 50 to 1000 |
| `LAI_AI_TEMPERATURE` | 0.4 | 0 to 1 |
| `LAI_AI_TIMEOUT_SECONDS` | 10 | 1 to 60; read timeout |
| `LAI_AI_MAX_ATTEMPTS` | 2 | 1 to 3; botocore standard retries, never more |
| `LAI_AI_MAX_REQUEST_BYTES` | 8192 | larger bodies are 400 before parsing |
| `LAI_AI_CHILD_TURNS_PER_MINUTE` / `_PER_DAY` | 12 / 300 | model calls, shared across processes |
| `LAI_AI_FAMILY_TURNS_PER_DAY` | 750 | all of one parent's children |
| `LAI_AI_SESSION_TURNS_PER_DAY` | 150 | per correlation `sessionId` |
| `LAI_AI_CHILD_CONCURRENT_TURNS` | 2 | in flight per child |
| `LAI_AI_GLOBAL_TURNS_PER_DAY` | 20000 | the application's own daily cost ceiling |
| `LAI_AI_PRICE_INPUT_PER_MTOK_USD`, `LAI_AI_PRICE_OUTPUT_PER_MTOK_USD`, `LAI_AI_PRICE_TABLE_VERSION` | unset | cost estimates only when set from the Bedrock pricing page |
| `LAI_AI_ALLOW_CLIENT_AUTHORED` | `true` | must stay on until every caller has a server context (section 11) |
| `LAI_AI_AUDIT_RETENTION_DAYS` | unset | no approved period; `ai_retention` refuses without one |

**Shared limits (LAI-0708).** PostgreSQL counters (`AIUsageCounter`), one atomic
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING` per scope and window, so they hold across
gunicorn workers and EC2 instances without adding Redis (the database is already shared;
proven by a 12-thread race test). Denied attempts count too. If the counter store fails, turns
fail closed (no model call). **Kill switch**: `AIServiceControl` in Django Admin (superusers),
effective on every process within 15 s, no deploy; `LAI_AI_PROVIDER=disabled` remains the
deploy-time switch.

Fail closed: `bedrock` without region, model or Guardrail raises `ImproperlyConfigured` in
production and `ProviderConfigurationError` (fallback, audited) anywhere else. There is no
unguarded Bedrock mode. In AWS the values are SSM parameters `/lai/<env>/django/LAI_AI_*`,
written by an operator from the `LaiAiGuardrail-<env>` outputs; the EC2 stack is not changed.

## 6. Guardrail and IAM (`infra/lib/aiGuardrailStack.ts`, stack `LaiAiGuardrail-<env>`)

Guardrail `lai-child-safety-<env>` with a published version:
- content filters HIGH (input and output): SEXUAL, VIOLENCE, HATE, INSULTS, MISCONDUCT;
  PROMPT_ATTACK HIGH on input;
- denied topics: private child or family information, secrecy from grown-ups, self-harm and
  danger, adult topics (romance, drugs, gambling, purchases, medical, legal);
- PII BLOCK (never anonymize): email, phone, address, username, password, IP, URL, identity
  documents, card and bank data. NAME and AGE are left out on purpose: authored copy is full of
  character names and ages of things, the child's own name and age are never sent, and asking for
  them is caught by the denied topic and Django's checks;
- AWS managed profanity list.

Managed policy `lai-django-ai-<env>`, attached by that stack to `lai-django-ec2-<env>` (or
`djangoRoleArn`):
- `bedrock:InvokeModel` on `arn:aws:bedrock:us-west-1:<account>:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`;
- `bedrock:InvokeModel` on `arn:aws:bedrock:{us-east-1,us-east-2,us-west-1,us-west-2}::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
  only through that profile (`bedrock:InferenceProfileArn` condition);
- `bedrock:ApplyGuardrail` on the Guardrail ARN.

The policy follows AWS's documented pattern for geographic profiles (inference-profile ARN in
the source Region, the foundation model in every destination Region, `StringLike` on
`bedrock:InferenceProfileArn`; Bedrock user guide, "Prerequisites for inference profiles", read
2026-11-01). Whether it works in this account is only provable live (LAI-0705).

**Monitoring (LAI-0708, same stack).** Ten metric filters on `/lai/<env>/django` parse the
`ai.turn v1` line into namespace `LearningAdventureIsland/DjangoAI` (Turns, Generations,
Fallbacks, ProviderErrors, GuardrailBlocks, RateLimited, LatencyMs, InputTokens, OutputTokens,
EstimatedCostMicroUsd). Seven alarms on the existing `lai-django-alarms-<env>` topic, missing
data not breaching: provider errors (10 per 15 min), fallback rate (50% over 30 min once 20
turns ran), Guardrail blocks (25 per hour), request spike (3000 per hour), average latency
(6 s over 15 min), output tokens (2M per day), rate-limited turns (100 per 15 min).

**Budget finding.** The Amplify stack's $50 budget filters `Service: Amazon Bedrock`. The Haiku
4.5 model card says Claude usage is billed through AWS Marketplace "under the model provider
(not under Amazon Bedrock)", so that budget may not see Claude spend at all. Unverified (no
account access); check it in Cost Explorer during LAI-0705 before relying on it. The
application-level ceilings above and the token alarms are the primary controls.

Also needed outside IAM: Bedrock model access for Claude Haiku 4.5 (Anthropic use-case form and
the AWS Marketplace subscription) in the account, and no SCP blocking the destination Regions.
Not deployed. Deploying is an APPROVAL step (ADR-019 G7, LAI-0705).

## 7. Audit, safety events and metrics

`AIInteractionAudit` and `SafetyEvent` (`lai/apps/ai/models.py`, LAI-0306) carry the Amplify
fields plus: provider, context source, Guardrail id, version and action, failure category, token
counts, latency, request correlation id. No column holds prompt text, model text or anything a
child typed. Rows are written only by `services/auditing.py` (best effort: a failed write never
changes a turn). Child deletion cascades them (`ChildOwnedModel`).

`ai.turn v1` log line (logger `lai.ai`), positional so CloudWatch can parse the numbers:
`ai.turn v1 <route> <AI|FALLBACK> <status> <disposition> <failure|-> <guardrail> <provider>
<context> <latency_ms> <input_tokens> <output_tokens> <estimated_cost_microusd> <ok|failed>`.
Closed vocabulary and numbers only: no ids, no text. The metric filters in section 6 depend on
this exact order; change both together and bump `v1`.

**Staff inspection (LAI-0707).** Django Admin, permission-gated (`ai.view_aiinteractionaudit`,
`ai.view_safetyevent`; `ai.change_safetyevent` for review status only), audited on every list,
view and change (`lai.admin_audit`), child UUID only. Filters: date, route, status, disposition,
provider, model, failure category, Guardrail action, context source. Each environment has its
own database, so "environment" is the admin you open, not a filter.

**Retention (LAI-0707).** `manage.py ai_retention --older-than-days N [--apply]`: dry run by
default; refuses without an explicit or configured period (none approved: LAI-0308, gate G9);
keeps OPEN safety events and the audit rows they link unless `--include-open`; only `ai_*`
rows; idempotent; counts-only output and one `ai.retention` log line. Running `--apply` in a
deployed environment needs approval. Parents can also clear a child's AI history themselves
(`DELETE .../ai/history/`).

**Cost.** `estimated_cost_microusd` on each audit row and in the metric line, only when prices
are configured and Bedrock reported usage; otherwise null. Never a billed amount.

## 8. Tests (no AWS)

- `tests/golden/test_ai_safety_python.py`: 186 golden cases generated from the TypeScript
  (`ai-safety` suite): validators, URL/PII/judgment checks, emotion normalisation, strategy
  ladder, vocabulary, `buildTutorContext` for every skill, fallback tables.
- `lai/apps/ai/tests/`: prompts verbatim, curriculum mirror, providers (fake, Bedrock request
  shape, response parsing, error mapping with a stubbed runtime), settings fail-closed, safety
  policy, and both endpoints (tenant checklist, every pipeline outcome, forged fields, no
  gameplay writes, DJANGO_SESSION derivation).
- `infra/lib/aiGuardrailStack.test.ts`: Guardrail policies and least-privilege IAM.

## 9. Live verification and Approval Gate A (LAI-0705; not done)

**Tooling.** `manage.py ai_live_check --parent-sub <sub> --child <uuid> [--warm-up] [--guardrail-probe]`, run on
the deployed host (SSM), so it uses the real EC2 role, settings and Guardrail. It scores each
check from the audit row the pipeline wrote, not from an HTTP 200: `source=AI`, `VALID`,
`provider=bedrock`, Guardrail applied (`NONE`), the configured model, the Guardrail id and
version, token usage. The probe sends text the Django screen lets through but the Guardrail
must block. `--warm-up` compiles the two structured-output schemas once with a 120 s timeout.
Output: outcomes, latency, tokens; exit 1 on anything unexpected. The HTTP path (routing,
Cognito, the client) is covered by `scripts/ai-red-team.ts --target django`.

**What Gate A needs approved (nothing below has been done):**

1. *Target:* the dev environment in the account that holds `LaiDjangoEc2-dev`, Region
   `us-west-1` (documented default). The account id was not read: AWS CLI access is denied in
   this session.
2. *Stacks:* deploy `LaiAiGuardrail-dev` (new) after `LaiDjangoEc2-dev`. No change to any other
   stack.
3. *IAM:* new managed policy `lai-django-ai-dev` attached to `lai-django-ec2-dev`
   (InvokeModel on the US profile and its four destination models through it; ApplyGuardrail
   on the new Guardrail). The Amplify roles are not touched.
4. *Guardrail:* `lai-child-safety-dev`, published version 1 (section 6).
5. *SSM:* `/lai/dev/django/LAI_AI_PROVIDER=bedrock`, `LAI_AI_BEDROCK_REGION=us-west-1`,
   `LAI_AI_MODEL_ID`, `LAI_AI_GUARDRAIL_ID`, `LAI_AI_GUARDRAIL_VERSION` (from the stack outputs);
   optionally the price settings. Then one Django release so the container reads them.
6. *Calls and tokens:* warm-up 2, live check 3, red team 27 model calls (2 more requests that
   never reach the model): about 32 calls. Each sends roughly 1.5k to 2k input tokens and at most
   300 output tokens: at most about 64k input and 10k output tokens.
7. *Cost:* at Claude Haiku 4.5 list prices (check the Bedrock pricing page; Marketplace billing),
   well under $0.50 in model tokens, plus Guardrail text units for about 32 short requests
   (cents). Conservative upper bound for the whole gate: **$2**.
8. *Rollback:* set `LAI_AI_PROVIDER=disabled` (SSM) and re-release, or flip the kill switch in
   Django Admin; detach the policy or delete `LaiAiGuardrail-dev`. Gameplay is unaffected
   either way; Amplify keeps serving the deployed React build throughout.
9. *Manual prerequisites:* Claude Haiku 4.5 model access in the account (Anthropic use-case
   form and Marketplace subscription), no SCP blocking the destination Regions, a dev parent
   account and a Django child for it, and the allow rule for read-only AWS CLI calls in this
   environment (the Cognito pool `learningadventureisland_dev` lookup is blocked the same way).

**After approval:** `aws bedrock get-inference-profile --region us-west-1
--inference-profile-identifier us.anthropic.claude-haiku-4-5-20251001-v1:0`; deploy; write SSM;
release; `ai_live_check --warm-up --guardrail-probe`; the Django red team; read the audit rows
and the `/lai/dev/django` log group for leaks; check Cost Explorer for where Claude spend shows.

## 10. Status matrix

Levels: (1) not started, (2) in progress, (3) implemented, (4) fake-model/local tests passed,
(5) live AWS tests passed, (6) browser acceptance passed, (7) deployed, (8) accepted.

| Task | Highest level reached | Blocking the next level |
|---|---|---|
| LAI-0306 audit models | 4 | merge |
| LAI-0701 AI domain | 4 | merge |
| LAI-0702 companion endpoint | 4 | LAI-0705 live smoke |
| LAI-0703 tutor endpoint, red team | 4 | live red team (LAI-0705) |
| LAI-0704 Guardrail and safety policy | 4 (synthesized) | Gate A deploy |
| LAI-0705 live Bedrock acceptance | 3 (tooling) | Gate A approval, AWS CLI access, model access, test identities |
| LAI-0706 React cutover | 4 | a Django-enabled dev deploy and a browser pass (Gate B) |
| LAI-0707 audit, admin, retention | 4 | an approved retention period (LAI-0308 / G9) |
| LAI-0708 limits, cost, monitoring | 4 (synthesized) | Gate A/D deploy; live alarm check |
| LAI-0709 server-owned context | 3 partial (NPC done) | adventures on Django sessions; a Django story catalog (LAI-0309); mastery (LAI-0603) |
| LAI-0710 Amplify AI retirement | 2 (audit only) | 0705, 0706, 0709 acceptance and explicit retirement approval |

## 11. Context ownership, retirement plan and rollback

### Context ownership matrix (LAI-0709)

| Caller | Route | Context today (Django build) | Fields from the browser | Server-owned path |
|---|---|---|---|---|
| NPC re-voicing (`NpcConversation.tsx`) | companion NARRATE | **DJANGO_CATALOG** | `npcId`, `nodeId` (identifiers) | done |
| Adventure celebrate / narrate / hint (`useAdventureSession.ts`) | companion | CLIENT_AUTHORED | step summary, authored step text or hint (published content, assembled by the browser) | DJANGO_SESSION exists, but React's adventure sessions still run on Amplify (`submitAdventureAnswer`) |
| Story choice narration (`useAdventureSession.ts`, creative choice) | companion NARRATE | CLIENT_AUTHORED | the chosen authored option label inside the summary | same as above |
| Story chapter scenes (`useStoryChapterRunner.ts`) | companion NARRATE | CLIENT_AUTHORED | scene id, resolved authored scene text | blocked: no Django story catalog (`stories.json` is not imported; LAI-0309) |
| Tutor hint ladder (`useAdventureSession.ts`) | tutor | CLIENT_AUTHORED, with skill, mastery titles and quest copy from Django | skill id, hint level (0 to 5), authored hint text | DJANGO_SESSION exists; same Amplify-session blocker |

Always server-side, whatever the source: the child, its age band and length limit, the AI
switch, prompts, strategy (from the hint level), vocabulary and curriculum copy, mastery titles
(statuses only; sparse until LAI-0603), quest copy, validation, audit. Never accepted from the
browser: grades, mastery, rewards, choice ids beyond the step's own (DJANGO_SESSION).
`LAI_AI_ALLOW_CLIENT_AUTHORED=false` turns the compatibility path off; it must stay on until
the two blockers above are cleared and accepted.

### Amplify AI dependency audit (LAI-0710; nothing removed)

| Reference | Kind | Retire when |
|---|---|---|
| `amplify/data/resource.ts` `generateCompanionTurn`, `generateTutorTurn`, `CompanionTurn`, `TutorTurn`, `TutorStrategy` | live AppSync routes | after LAI-0706 acceptance and approval |
| `amplify/backend.ts` `grantBedrockInvoke` (two IAM role patches), the validation-failure alarm, the Bedrock budget | live IAM and monitoring | with the routes; replace the budget first (section 6 finding) |
| `amplify/data/chattyPersona.ts`, `tutorPersona.ts` | prompts; also imported by `react/src/features/{companion,tutor}/api.ts` for audit versions and read by `lai/apps/ai/tests/test_prompts.py` | move the prompt source of truth to Django, then delete |
| `react/src/features/companion/api.ts`, `tutor/api.ts` Amplify branch, browser audit writes | client code for builds without `VITE_BACKEND=django` (today's deployed build) | when every deployed build sets `VITE_BACKEND=django` |
| `amplify/data/resource.ts` `AIInteractionAudit`, `SafetyEvent` models, `parent-dashboard/api.ts` and `child-profile/deletion.ts` Amplify paths | live data and parent controls | after the Phase 11 data migration (rows exist in Amplify) |
| `scripts/live-smoke.ts`, `scripts/ai-red-team.ts --target amplify` | operator scripts | with the routes |
| `lai/apps/ai` route names `generateCompanionTurn`/`generateTutorTurn` | audit vocabulary kept for continuity | keep |

Amplify Hosting, Cognito, Storage and the non-AI AppSync models stay. Note: `amplify.yml` runs
`ampx pipeline-deploy` on every Amplify Hosting build of a connected branch, so any push of an
Amplify-connected branch deploys the Amplify backend.

### Rollback (keep until LAI-0710 is accepted)

- *Frontend AI routing:* rebuild without `VITE_BACKEND=django` (or with the previous artifact):
  every AI call goes back to the Amplify routes, which stay deployed until LAI-0710.
- *Django AI:* `LAI_AI_PROVIDER=disabled` (SSM, re-release) or the Admin kill switch (no
  deploy): authored content everywhere, gameplay unaffected.
- *Failing invocations:* the `ai.turn` metrics and alarms, the audit rows (`failure_category`,
  `validation_status`, `request_id`), and `ai_live_check`.
- *Audit continuity:* both backends write the same route names; Amplify rows stay in Amplify
  until the Phase 11 import.
- *If the Amplify routes were already removed:* revert the LAI-0710 commit and redeploy the
  Amplify backend from it (the routes are code; the IAM patch is reapplied by `backend.ts`).

### Remaining blockers

AWS CLI access (denied in this session), Bedrock model access, a dev parent and Django child,
Gate A approval (deploy, IAM, SSM, paid calls), a Django-enabled dev frontend deploy and browser
pass (Gate B), adventures running on Django sessions, a Django story catalog (LAI-0309), server
mastery (LAI-0603), an approved retention period (LAI-0308 / G9), and explicit retirement
approval for LAI-0710.

