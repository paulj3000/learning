# Django AI Service (Phase 7: LAI-0306, LAI-0701 to LAI-0704)

Status (2026-11-01, branch `features/ai`, unmerged): **implemented and verified with the fake
provider only.** Live Bedrock has not been called, the Guardrail is not deployed, and the React
client still uses the Amplify routes. See section 10 for the status ladder.

Decision: ADR-043 (builds on ADR-019 sub-decision 9). Safety principles:
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

Both are child-scoped (`ChildScopedAPIView`, LAI-0403): Cognito bearer token, the child resolved
through the authenticated parent, another family's child or an unknown id is the same 404.

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
3. Per-child rate limit (`LAI_AI_TURNS_PER_CHILD_PER_HOUR`, default 120): `RATE_LIMITED`.
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
| `LAI_AI_TIMEOUT_SECONDS` | 10 | 1 to 60; read timeout, one standard retry |
| `LAI_AI_TURNS_PER_CHILD_PER_HOUR` | 120 | model calls; per Django process (local-memory cache) |

Fail closed: `bedrock` without region, model or Guardrail raises `ImproperlyConfigured` in
production and `ProviderConfigurationError` (fallback, audited) anywhere else. There is no
unguarded Bedrock mode. In AWS the values are SSM parameters `/lai/<env>/django/LAI_AI_*`, written
by an operator from the `LaiAiGuardrail-<env>` outputs; the EC2 stack is not changed.

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

Also needed outside IAM: Bedrock model access for Claude Haiku 4.5 (Anthropic use-case form and
the AWS Marketplace subscription) in the account, and no SCP blocking the destination Regions.
Not deployed. Deploying is an APPROVAL step (ADR-019 G7, LAI-0705).

## 7. Audit, safety events and metrics

`AIInteractionAudit` and `SafetyEvent` (`lai/apps/ai/models.py`, LAI-0306) carry the Amplify
fields plus: provider, context source, Guardrail id, version and action, failure category, token
counts, latency, request correlation id. No column holds prompt text, model text or anything a
child typed. Rows are written only by `services/auditing.py` (best effort: a failed write never
changes a turn). Child deletion cascades them (`ChildOwnedModel`).

`ai.turn` log line (logger `lai.ai`), closed vocabulary only:
`route=... source=AI|FALLBACK status=... disposition=... failure=... guardrail=... provider=...
context=... latency_ms=... audit=ok|failed`. A CloudWatch metric filter on it (LAI-0708) replaces
the Amplify `LearningAdventureIsland/AI` metrics. The Amplify Bedrock budget alarm stays.

Retention and review UI are not built (LAI-0707).

## 8. Tests (no AWS)

- `tests/golden/test_ai_safety_python.py`: 186 golden cases generated from the TypeScript
  (`ai-safety` suite): validators, URL/PII/judgment checks, emotion normalisation, strategy
  ladder, vocabulary, `buildTutorContext` for every skill, fallback tables.
- `lai/apps/ai/tests/`: prompts verbatim, curriculum mirror, providers (fake, Bedrock request
  shape, response parsing, error mapping with a stubbed runtime), settings fail-closed, safety
  policy, and both endpoints (tenant checklist, every pipeline outcome, forged fields, no
  gameplay writes, DJANGO_SESSION derivation).
- `infra/lib/aiGuardrailStack.test.ts`: Guardrail policies and least-privilege IAM.

## 9. Live verification (requires explicit approval; not done)

1. Owner approves LAI-0705: AWS credentials, Bedrock invocation cost, IAM change, deploy.
2. Confirm model access and the profile from the deployment Region:
   `aws bedrock get-inference-profile --region us-west-1 --inference-profile-identifier us.anthropic.claude-haiku-4-5-20251001-v1:0`.
3. Deploy `LaiAiGuardrail-dev` after `LaiDjangoEc2-dev`; write the SSM parameters from its outputs
   and `LAI_AI_PROVIDER=bedrock`, `LAI_AI_BEDROCK_REGION=us-west-1`; release Django.
4. Smoke: one companion and one tutor turn for a dev child; check the audit rows (`provider=bedrock`,
   `guardrail_action=NONE`, token counts).
5. Red team: `npx tsx scripts/ai-red-team.ts --target django` with `LAI_DJANGO_API_URL`,
   `LAI_CHILD_ID`, `TEST_PARENT_EMAIL`, `TEST_PARENT_PASSWORD`; record the summary. The Amplify
   target (`--target amplify`, the default) is unchanged.

## 10. Status ladder

| Level | Meaning | State |
|---|---|---|
| 1 | Django AI functionality implemented | Done (features/ai) |
| 2 | Verified with the fake provider | Done (unit, API and golden tests) |
| 3 | Live Bedrock verified (dev) | Not started: LAI-0705, needs approval |
| 4 | React cutover completed | Not started: LAI-0706 |
| 5 | Amplify AI routes retired | Not started: LAI-0710 |

## 11. Remaining work (tracked, not implemented)

- **LAI-0705** Live Bedrock and Guardrail verification in dev (APPROVAL).
- **LAI-0706** React cutover: `react/src/api/ai.ts` behind `VITE_BACKEND`, send `templateId`,
  use `DJANGO_SESSION` where the session runs on Django, stop browser audit writes on that path.
- **LAI-0707** Safety review: read-only, audited Django Admin views of `SafetyEvent` and
  `AIInteractionAudit`, review-status workflow, retention schedule (with LAI-0308 / G9).
- **LAI-0708** Operations: shared rate-limit store, CloudWatch metric filters and alarms on
  `ai.turn` (port the Amplify validation-failure alarm), keep the Bedrock budget.
- **LAI-0709** Server-built context for NPC and story turns and server mastery status (after
  LAI-0603), so `CLIENT_AUTHORED` can be retired.
- **LAI-0710** Retire `generateCompanionTurn`, `generateTutorTurn` and their IAM grants (APPROVAL,
  after LAI-0706 acceptance; part of Phase 13).
