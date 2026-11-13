# Bedrock acceptance runbook (LAI-0705, LAI-AQS-025)

**Status: nothing in this document has been run against AWS.** Every command below that costs
money says so, and every such command refuses to run without an explicit flag. Until the owner
runs the steps and records the evidence, the AI service is "implemented and fake-verified"
(`docs/AI_SERVICE.md` section 10) and the Guardrail is "synthesized, not deployed". Nothing here
may be reported as accepted from mocked tests.

Prepared on branch `feature/ai-bedrock-readiness` (2026-11-04). Reference: `docs/AI_SERVICE.md`
(design, IAM, Guardrail), `docs/AI_QUESTION_STUDIO.md` (Studio).

## 0. Free before paid

| Tool | Cost | What it does |
|---|---|---|
| `manage.py ai_live_check --dry-run` | free, no AWS call | Prints the configuration a live run would use and what is missing or unsafe. Reads settings and one database row (the kill switch). Never imports boto3, never builds a Bedrock client, never reads credentials, and refuses to be combined with any other option. |
| `manage.py studio_run_batch --dry-run` | free, no AWS call | Lists queued Studio batches, the model, whether it is approved, quota left, and the worst-case number of model calls. |
| `manage.py studio_batch_report --id <uuid>` | free, read-only | Rows, validation outcomes, tokens, estimated cost and cost per question for a finished batch. |
| `make py-test-db` and `npx vitest run infra` | free | The deterministic suites (fake provider, stubbed boto3 runtime, synthesized CDK). |

Exit status 1 and a `blocking` list mean do not start the paid run.

## 1. Environment (SSM `/lai/<env>/django/...`)

| Variable | Needed for | Notes |
|---|---|---|
| `LAI_AI_PROVIDER=bedrock` | all | `fake` is the default; `disabled` is the deploy-time off switch. |
| `LAI_AI_BEDROCK_REGION` | all | The Region of the inference profile (documented default `us-west-1`). |
| `LAI_AI_MODEL_ID` | all | Default `us.anthropic.claude-haiku-4-5-20251001-v1:0`. |
| `LAI_AI_GUARDRAIL_ID`, `LAI_AI_GUARDRAIL_VERSION` | all | From the `LaiAiGuardrail-<env>` stack outputs. Pin a numeric version, not `DRAFT`. Missing values fail closed. |
| `LAI_AI_PRICE_INPUT_PER_MTOK_USD`, `LAI_AI_PRICE_OUTPUT_PER_MTOK_USD`, `LAI_AI_PRICE_TABLE_VERSION` | cost figures | Read from the Bedrock pricing page for the model. Unset means cost is reported as unknown, never guessed. |
| `LAI_AI_TIMEOUT_SECONDS` (10), `LAI_AI_MAX_ATTEMPTS` (2) | timeouts | A turn waits at most timeout x attempts. |
| `LAI_AI_FIRST_CALL_TIMEOUT_SECONDS` (unset) | first-call latency | Set only from evidence in step 6. |
| `LAI_AI_CHILD_TURNS_PER_MINUTE` and the other `LAI_AI_*_PER_DAY` limits | step 10 | Defaults are in `docs/AI_SERVICE.md` section 5. |
| `LAI_STUDIO_RUN_MODE=manual` | step 12 | So that pressing Generate in Django Admin never starts a paid batch by itself. |
| `LAI_STUDIO_APPROVED_MODEL_IDS` | step 12 | Empty approves only `LAI_AI_MODEL_ID`. |
| `LAI_AI_NPC_ENFORCE_ELIGIBILITY` (false) | NPC narration | Leave off until Django holds NPC state (LAI-0605). |

Owner prerequisites (not code): Bedrock model access for Claude Haiku 4.5 (Anthropic use-case form
and Marketplace subscription), no SCP blocking the destination Regions, `LaiAiGuardrail-<env>` and
the `lai-django-ai-<env>` policy deployed (Gate A, `docs/AI_SERVICE.md` section 9), a dev parent
account with one test child (AI switched on), the content catalog loaded (`manage.py
load_content`) and Django superuser access for the kill switch.

## 2. The workflow

Run on the deployed host (for example through the SSM release document) so the real instance
role, settings and Guardrail are used. Replace `<sub>` with the test parent's Cognito sub and
`<child>` with the test child's id. The output never contains the child's nickname, the model's
text or credentials.

| # | Check | Command or action | Cost | Pass when |
|---|---|---|---|---|
| 1 | Bedrock access and model availability | `aws bedrock get-inference-profile --region <region> --inference-profile-identifier <model id>` (read-only), then step 4 | free | The profile exists and lists its destination Regions. Access itself is proved by step 4 returning `source=AI`. |
| 2 | Guardrail id and version | `ai_live_check --dry-run`, then `aws bedrock get-guardrail --guardrail-identifier <id> --guardrail-version <n>` | free | Dry run shows both values set and the version is numeric. The CLI shows status `READY` and the policies in `docs/AI_SERVICE.md` section 6. |
| 3 | IAM permissions | `aws iam get-policy-version` for `lai-django-ai-<env>`, compared with `infra/lib/aiGuardrailStack.ts` | free | InvokeModel on the profile and its destination models and ApplyGuardrail on this Guardrail only. A failed call in step 4 with `ACCESS_DENIED` means this step is wrong. |
| 4 | Companion turn | `ai_live_check --confirm-paid-calls --parent-sub <sub> --child <child>` | paid (1 call) | `companion` passed: `source=AI`, `VALID`, `provider=bedrock`, `guardrail_action=NONE`, model id matches, tokens reported. |
| 5 | Tutor turn | same run | paid (1 call) | `tutor` passed, same evidence. The tutor prompt also carries the server-built `learnerProfile` (LAI-0603); check it in the audit row's context, not in the output. |
| 6 | First-call latency | add `--warm-up` to the run above | paid (2 calls) | `firstCallLatencyMs` shows how long Bedrock took to compile each schema. If it exceeds `LAI_AI_TIMEOUT_SECONDS`, decide with the owner whether to set `LAI_AI_FIRST_CALL_TIMEOUT_SECONDS` (bounded to 60, first request per schema per process only) or to warm the service on release. Do not raise the normal timeout. |
| 7 | NPC narration | add `--npc` | paid (1 call) | `npc-narration` passed with `context_source=DJANGO_CATALOG`. Fails with "catalog content not loaded" if `load_content` was not run. |
| 7b | NPC Manager hint (LAI-NPC-030 to 033) | add `--npc-manager-hint`. Prerequisites: an ACTIVE NPC release whose Pirate Pip is `HYBRID` with an approved persona for the test child's age band (`manage.py seed_npc_pip --hybrid-hints --publish` on a fresh Pip, or set Pip's dialogue mode and persona in Django Admin and publish) | paid (1 call) | `npc-manager-hint` passed: route `generateNpcHint`, `source=AI`, `VALID`, `provider=bedrock`, `guardrail_action=NONE`, `context_source=DJANGO_CATALOG`, tokens reported. It opens and ends one Pip conversation for the test child and writes no progress. Persona boundaries, Guardrail redirects and every fallback are proved with the fake model in `lai/apps/npcs/tests/test_ai_hint_api.py`. |
| 8 | Guardrail intervention | add `--guardrail-probe` | paid (1 call) | `guardrail-probe` passed: `BLOCKED_GUARDRAIL`, a calm redirect line, one new `SafetyEvent`. A pass proves one probe is blocked, not that the Guardrail is effective in general. |
| 9 | Malformed response fallback | not forceable on a live model | free | Proved only with the stubbed runtime (`lai/apps/ai/tests/test_bedrock_reliability.py`). Live evidence is indirect: after the red team in step 11, the audit table's `INVALID_SCHEMA` count is zero or those rows served authored text. |
| 10 | Timeout, retry, rate limit, kill switch | `--timeout-probe` (paid, may be billed though abandoned). Rate limit: temporarily set `LAI_AI_CHILD_TURNS_PER_MINUTE=1`, release, send two turns. Kill switch: switch off model calls in Django Admin (AI service control), send a turn, switch back on. | timeout probe paid (1 call); the others free | Timeout probe: `FALLBACK` with `failure_category=TIMEOUT`. Rate limit: the second turn is `RATE_LIMITED` with no Bedrock call. Kill switch: `KILL_SWITCH`, authored text, no Bedrock call, effective within the control cache window. Restore every setting afterwards. |
| 11 | Django red team | `LAI_DJANGO_API_URL=<api base> LAI_CHILD_ID=<child> TEST_PARENT_EMAIL=... TEST_PARENT_PASSWORD=... npx tsx scripts/ai-red-team.ts --target django` (from a machine with a test identity; header of the script has the full usage) | paid (about 27 calls) | The report's expectations hold. Read the audit rows and the `/lai/<env>/django` log group for leaks of prompts, ids or credentials. |
| 12 | Audit and safety-event records | Django Admin, AI interaction audits and safety events; or a shell query | free | One audit row per turn with route, model id, Guardrail id and version, context source, tokens, latency, estimated cost and no text. A SafetyEvent for the guardrail probe and for screened input, none for ordinary turns. The parent safety history endpoint shows them to the owning parent only. |
| 13 | Studio five-question batch | see section 3 | paid (1 call typical, 4 worst case) | Section 3. |
| 14 | Tokens, requests and cost | the `usage` block in the `ai_live_check` output, the `ai.turn` metric logs, `studio_batch_report`, and Cost Explorer | free | Compare the estimate with Cost Explorer a day later (section 4). |

## 3. AI Question Studio, five questions (LAI-AQS-025)

Nothing is published automatically: generated rows are drafts, validation is deterministic, and
approval and publishing are separate staff actions.

1. Set `LAI_STUDIO_RUN_MODE=manual` and release. Pressing Generate then only queues a batch.
2. In Django Admin (a staff user with the generate permission) open Generation batches, Generate,
   choose Math, Grade 3, topic Multiplication, count 5, and submit. One batch is queued.
3. `manage.py studio_run_batch --dry-run` shows the model, whether it is approved, the token
   quota and `worstCaseModelCalls` (one chunk x `LAI_STUDIO_MAX_ATTEMPTS` x `LAI_AI_MAX_ATTEMPTS`,
   4 by default; a clean run is 1).
4. `manage.py studio_run_batch --id <batch id> --confirm-paid-calls` runs it. Without the flag
   the command refuses under Bedrock.
5. `manage.py studio_batch_report --id <batch id>` prints status, failure category, model, chunks,
   attempts, tokens, estimated cost, **estimated cost per question**, and for each question its
   review status and the validation findings (check name and severity). Add `--show-text` to read
   the stems. Read-only.
6. In Admin, open the batch's questions: the validation report, near-duplicates and edits are
   there. Expect some `FAIL` rows (arithmetic, duplicate, safety): that is the checks working.
   Approve and publish only if the owner chooses to; the test passes without publishing.
7. Pass when: status `COMPLETED` or an explained `PARTIAL`; all five rows exist as drafts;
   `published` is 0 in the report; token counts and (with prices set) cost per question are
   recorded; a Guardrail-blocked or malformed reply stores nothing as playable.

Also record: the output schema was accepted by structured output, and whether the 60 second
`LAI_STUDIO_TIMEOUT_SECONDS` was enough for one chunk (step 4 latency in the audit).

## 4. Cost controls and what they do not cover

In force (all tested with fakes, none verified live):

- Per-child, per-family, per-session and global daily turn limits and a per-child concurrency cap,
  stored in PostgreSQL so they hold across processes; denied turns make no model call.
- A runtime kill switch (Django Admin) and `LAI_AI_PROVIDER=disabled`; a broken limit store fails
  closed to authored content.
- Bounded retries: at most `LAI_AI_MAX_ATTEMPTS` (cap 3) SDK attempts, never a retry loop in the
  turn path; a request-size cap; `LAI_AI_MAX_OUTPUT_TOKENS` (50 to 1000).
- Studio: chunk size, `LAI_STUDIO_MAX_ATTEMPTS`, batch and daily question quotas, a daily token
  quota that stops a running batch, and an approved-model list.
- Per-turn and per-batch estimated cost, only when prices are configured.
- Alarms and metric filters in `LaiAiGuardrail-<env>` (synthesized, not deployed).

Known limits, not claims:

- **Marketplace billing.** Claude on Bedrock is billed through AWS Marketplace. The Amplify $50
  budget filters on the service `Amazon Bedrock`, so it may not see Claude spend at all. Check
  where the charge appears in Cost Explorer (it lags about a day) before relying on any budget
  alarm. Until then the only hard cost guards are the application limits above.
- **Guardrail charges** are billed separately from model tokens (text units per assessment) and
  are not in the per-turn estimate.
- **Unreported spend.** A timed-out, abandoned or blocked call may be billed but returns no usage,
  so the estimate undercounts. The timeout probe is expected to be one such call.
- The estimate is `tokens x configured price`; it is not a bill and is wrong if the prices are.
- A passing Guardrail probe is one input, not a measurement of effectiveness or of false
  positives on island copy. Neither is known until live evidence exists.

## 5. Evidence to record

Copy the JSON from each paid run (it contains no child data) and fill this in
`docs/IMPLEMENTATION_STATUS.md` or the task tracker. **Do not mark LAI-0705 accepted, the
Guardrail validated, or billing covered from anything but these results.**

| Item | Result | Date | Run by |
|---|---|---|---|
| Dry run `ready` | | | |
| Companion, tutor, NPC checks | | | |
| First-call latency (ms) | | | |
| Guardrail probe | | | |
| Timeout probe | | | |
| Rate limit and kill switch drills | | | |
| Django red team | | | |
| Studio batch (status, tokens, cost per question) | | | |
| Cost Explorer line item for the run | | | |

## 6. Rollback

Set `LAI_AI_PROVIDER=disabled` (SSM) and release, or switch model calls off in Django Admin
(takes effect within the control cache window, no deploy). Gameplay never depends on a model
turn. Detach `lai-django-ai-<env>` or delete `LaiAiGuardrail-<env>` to remove access. Restore any
limit you lowered for a drill. The Amplify AI path is untouched throughout.
