# NPC Manager: AI and Polly acceptance gates (2026-11-11)

Scope: the remaining live AI/Polly gates for the NPC Manager (Trello "[Subproject] NPC Manager",
`docs/NPC_MANAGER_BROWSER_ACCEPTANCE.md` B7 and B8, `docs/audio/POLLY_DEPLOYMENT_RUNBOOK.md`,
`docs/AI_BEDROCK_ACCEPTANCE.md`). Branch: `integration/npc-manager-main` (PR #4 stack + PR #1 +
`main` at `0b4a2fba`). Nothing was merged to `main`, deployed, or changed in AWS.

**Headline (updated 2026-11-11, live run with `learning-dev`).** Every fake-client gate passes on
the reconciled branch. **Every live Bedrock gate passes** against the real `lai-child-safety-dev`
Guardrail (version 1) in us-west-1: companion, tutor, NPC narration, the NPC Manager persona hint,
the Guardrail probe, the timeout probe, child ownership and authored fallbacks (11 Bedrock calls,
13,201 input and 460 output tokens). **Live Polly passes in us-west-2** once the owner granted
`polly:SynthesizeSpeech`: synthesis, cache (memory), failure fallback and Pip's own voice line.
us-west-1 offers no neural voices, so speech runs in us-west-2. Still open: the S3 bucket steps
and the audible browser check. No infrastructure was created or changed by Claude.

## 1. Pull requests and dependencies

| PR | Head -> base | State | Notes |
|---|---|---|---|
| #2 | `qa/npc-manager-acceptance` -> `feature/npc-manager` | open | QA pass, four fixes, browser specs. Base of #4 and #18. |
| #4 | `fix/npc-qa-fa-fb` -> `qa/npc-manager-acceptance` | open | F-A, F-B, legacy-spec updates, idempotent `end` + no racing `end`, pirate Pip variant. |
| #18 | `fix/npc-manager-fa-fb` -> `qa/npc-manager-acceptance` | open | A second, independent fix of F-A, F-B and the legacy specs ("F-C"). **Conflicts with #4 in 15 files: only one can merge.** Keeps the racing best-effort `end` (intermittent `404`/`409` console errors seen in the #4 reruns). |
| #1 | `feature/sm-p8-live-polly` -> `feature/npc-manager` | open | SM-P8-LIVE: real Polly path, S3 store, Pirate Pip voice profile, `speech_live_smoke`, runbook. Conflicts with the #2 stack only in `docs/IMPLEMENTATION_STATUS.md`. |

All NPC branches fork from `5f6c26f5` and were 128 commits behind `main`; each conflicts with
`main` in the same 13 files (the `dev20261103` overlap predicted in the QA report, now on `main`).
`main` contains only the original SM-P8 speech service, so PR #1 duplicates nothing.

## 2. Reconciliation with `main` (`integration/npc-manager-main`)

- Merged PR #4's stack, then PR #1, then `main`. 13 conflicts resolved:
  - `catalog.NpcDefinition` keeps both `main`'s `Authorable` (ADR-047 content authority) and the
    NPC `origin` field; both import guards kept. Merge migration `catalog/0010_merge_npc_manager`
    (no model changes; `makemigrations --check` clean).
  - **ADR renumbering:** `main` gave ADR-050 to sound cues. The NPC Manager is now **ADR-053**;
    30 NPC-side references were renumbered line by line; next free number 054; `adr:check` passes
    (53 decisions).
  - Treasure Rush and Castle code: unions of both sides (content pinning reload, castle rooms,
    storybook, guide, NPC stage and speech slot). NPC test fakes gained `main`'s new interface
    members.
- Two tests changed to `main`'s contracts: the NPC hint request now ends with `main`'s guarded
  placeholder part (fix D-3), and `make runserver` binds the owner's dev port 8010.
- Follow-up (not a blocker): a managed NPC's panel has no launch or puzzle-return actions, which
  `main`'s `PipDialog` gained. Treasure Cove's Pip uses neither today.

## 3. Gate results

PASS = verified with evidence here. FAIL = ran and failed. BLOCKED = cannot run without an owner
action. NOT RUN = deliberately not run (reason given).

### Repository and fake-client gates

| # | Gate | Result | Evidence |
|---|---|---|---|
| R1 | PR inventory and dependencies | PASS | Section 1 |
| R2 | Reconcile NPC Manager QA fixes with latest `main` | PASS | Section 2; typecheck, Ruff, Prettier, `adr:check`, `makemigrations --check` clean |
| R3 | Full Django suite (fake AI, fake/disabled speech, PostgreSQL 16) | PASS | 3265 passed, 4 skipped, 0 failed; the first run found 2 merge-contract failures, both fixed |
| R4 | Full Vitest suite | PASS | 5013 passed, 439 files |
| U1 | Polly client over botocore Stubber: MP3 checks, error classes, retries only on transient errors, IAM/voice/input never retried | PASS | `speech/tests/test_polly_client.py` (33) |
| U2 | S3 speech store: region, SigV4, `speech/shared` vs `speech/child` keys, presign failure | PASS | `test_speech_storage.py` (19) |
| U3 | API end to end on the real client: synthesis, cache hit, child authorization, throttling, timeout, IAM denial, invalid voice, malformed input, storage failure, presign fallback, Pip seed to publish to heard | PASS | `test_live_path.py` (23) |
| U4 | Smoke command logic (live test itself skipped) | PASS | `test_live_smoke.py` (10 + 1 skipped by design) |
| U5 | NPC voice: profiles, validation, `npcDialogueNode` references, pre-generation | PASS | `test_voice_validation.py` (9), `test_npc_dialogue_node.py` (19), `test_voice_pregenerate.py` (13) |
| U6 | Captions, mute, failure fallback in the browser player (fake fetch) | PASS | Vitest `audio/speech` + `npc-manager/voice` + host: 123 tests, incl. `pollyLive.test.ts` |
| U7 | NPC Bedrock hint, fake model: persona, safety boundaries (humanity, secrecy, dependency), Guardrail intervention, redirect/stop, timeout, invalid output, kill switch, parent switch, rate limit, provider disabled, child ownership (another family 404, unauthenticated), authored fallback, no client text, no progress writes | PASS | `npcs/tests/test_ai_hint_api.py` (35), `test_ai_persona.py` (44), `ai/tests/test_npc_hint_contract.py` (20) |
| U8 | Bedrock client reliability (timeouts, retries, first-call timeout) | PASS | `ai/tests/test_bedrock_reliability.py` (43) |
| U9 | Live-check command, incl. the new `--npc-manager-hint` (rehearsed on the fake model) | PASS | `ai/tests/test_live_check_command.py` (21) |
| B7.1, B7.4 | Captions only when speech disabled; mute gives text only | PASS (browser, QA pass 2026-11-07) | `npc-4-a11y.spec.ts`, `npc-3-castle.spec.ts` |
| B7.2, B8.2 to 8.4 | Fake speech provider; fake/disabled AI and the parent switch in the browser | NOT RUN in a browser this pass | Covered by U3, U6 and U7; the owner checklist steps remain |

### AWS and live gates

| # | Gate | Result | Evidence and reason |
|---|---|---|---|
| L0 | `learning-dev` credentials | **PASS** (2026-11-11) | `sts get-caller-identity`: IAM user `learning-dev`, account `008331939914`. Enabled by replacing the repo's blanket `aws` deny with read-only allow rules (owner decision). |
| L1 | Bedrock and Guardrail configuration | **PASS** | Guardrail `lai-child-safety-dev` (`gf7ct9fgtbjf`), version `1` READY in us-west-1; policies match `infra/lib/aiGuardrailStack.ts` (5 content filters HIGH/HIGH, prompt attack HIGH input, 4 denied topics, profanity, PII BLOCK; v1 also blocks `US_INDIVIDUAL_TAX_IDENTIFICATION_NUMBER`, stricter than the repo, no NAME/AGE). Inference profile `us.anthropic.claude-haiku-4-5-20251001-v1:0` ACTIVE (us-east-1/2, us-west-1/2). `ai_live_check --dry-run`: ready, 0 blockers, 0 AWS calls. |
| L2 | Polly live audio (B7.3 server side, SM-P8-LIVE-07) | **PASS** (us-west-2, after the owner granted `polly:SynthesizeSpeech`) | `speech_live_smoke --profile pirate-pip`: region PASS (Justin neural), synthesis PASS (28.7 KB MP3, 273 ms), sample saved for listening. Earlier the same day: us-west-1 region FAIL (no neural voices), and `AccessDeniedException` in both regions before the permission was added. |
| L3 | Polly cache | **PASS** (memory and S3) / presigned fetch: **FIXED, owner rerun** | S3 bucket `learning-adventure-island-dev-speech` (us-west-2): cache (one Polly call for two requests), S3 read-back (28,700 bytes) and URL signing PASS. The presigned fetch failed with `403 SignatureDoesNotMatch` both here and on the owner's machine with real credentials. **Cause (a real defect, found 2026-11-11):** `S3SpeechStorage` signed URLs for the global host `<bucket>.s3.amazonaws.com`; S3 redirects that host to `<bucket>.s3.us-west-2.amazonaws.com` and the signature no longer matches. Fixed by building the client on the regional endpoint (`lai/apps/speech/storage.py`) with a regression test (`test_presigned_urls_use_the_regional_host`). Owner: rerun the S3 smoke command. |
| L4 | Captions and mute with real audio (runbook section 9) | **PASS (audible, owner)** / owner check | The owner heard Pip's voice in the browser (2026-11-11). Captions, mute and music ducking remain on the owner's checklist (B7.3, runbook section 9). |
| L5 | Polly failure fallback | **PASS** | AWS refused an invalid voice, mapped to `speech_unavailable (invalid_voice)`, captions remain; a voice outside the table is refused before any AWS call. |
| L6 | NPC voice behaviour live (server side) | **PASS** | NPC release 1 carries Pip's `pirate-pip` voice; a Pip `on_interact` node carries an `npcDialogueNode` speech reference; `speak` synthesized it in Justin neural (36.6 KB, 0.9 s), the second request was a cache hit, and a missing node is refused (`not_found`). Hearing it in the browser from Pip's position is L4. |
| L7 | Bedrock persona behaviour (B8.5) | **PASS** | `ai_live_check --npc-manager-hint`: route `generateNpcHint`, `source=AI`, `VALID`, `provider=bedrock`, Guardrail `NONE`, `DJANGO_CATALOG`, 1138 in / 43 out tokens, 2.4 s. Companion, tutor and NPC narration also PASS (Guardrail `NONE`, tokens reported). |
| L8 | Bedrock safety and Guardrail | **PASS** | `--guardrail-probe`: `BLOCKED_GUARDRAIL`, Guardrail `INTERVENED`, calm redirect line, one `SafetyEvent`. |
| L9 | Bedrock timeout | **PASS** | `--timeout-probe` (rerun after the first run's own 12-turn cap refused it as `RATE_LIMITED`): `FALLBACK`, failure `TIMEOUT`, authored line, 312 ms. |
| L10 | Child ownership on the live path | **PASS** | A child of another parent: `No such child.`, refused before any model call (audit rows 16 before, 16 after). |
| L11 | Authored fallback on the live path | **PASS** | Served for the Guardrail block (L8), the timeout (L9) and the rate limit; never an error. |
| L12 | Spend recorded against the bill | **PASS (estimate)** / owner check | 11 Bedrock calls, 13,201 input and 460 output tokens in total (plus Guardrail text units); no prices configured, so Django reports cost as unknown. Owner: compare with Cost Explorer for 2026-11-11. Polly: 368 characters synthesized in us-west-2 (smoke 2 x 111 SSML characters, Pip line 146). |

## 4. Region result

Bedrock: us-west-1 with the US cross-region inference profile works (L7 to L11).

Polly: **us-west-1 offers only standard voices** (Justin, Ivy, Joanna, Matthew standard; Kevin,
Ruth, Stephen absent), so every starter voice profile, all neural, fails there. **us-west-2 offers
the full neural set** and the smoke test's region step passes there. Set
`LAI_SPEECH_AWS_REGION=us-west-2` (and keep the speech bucket in us-west-2); Bedrock stays in
us-west-1. The settings are independent.

## 5. Owner actions

Done on 2026-11-11: `aws` read-only access (allow rules in `.claude/settings.json`), the live
Bedrock spend (owner approved), and the Guardrail (`lai-child-safety-dev`, version 1).

Still needed:
1. ~~Grant `learning-dev` Polly synthesis~~ Done by the owner; smoke test PASS.
2. ~~Create the speech bucket~~ Done: `learning-adventure-island-dev-speech` (us-west-2); S3
   steps PASS. Run the S3 smoke command once from your own machine (real credentials) to confirm
   the presigned-URL fetch, and add the `speech/child/` 2-day lifecycle rule.
3. Choose PR #4 or PR #18 (section 7).

Outstanding infrastructure (not created by Claude):
- **IAM (speech):** `polly:SynthesizeSpeech`, `polly:DescribeVoices` (smoke only) on `*`;
  `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `arn:aws:s3:::<speech-bucket>/speech/*`
  (runbook section 3).
- **IAM (AI):** the `lai-django-ai-<env>` policy (InvokeModel on the profile and its destination
  models, ApplyGuardrail on the Guardrail; `infra/lib/aiGuardrailStack.ts`).
- **S3:** private speech bucket, Block Public Access, lifecycle expiring `speech/child/` after 2
  days, CORS only with `LAI_SPEECH_DELIVERY=s3`.
- **Voice profile:** `seed_speech_voices` then `seed_npc_pip --attach-voice` and a publish, so the
  release snapshot carries Pip's `pirate-pip` voice.
- **Deployed host:** SSM `LAI_SPEECH_*` and `LAI_AI_*` values; runtime role with the policies
  above; the paid AI run is meant to run there (real instance role and Guardrail).
- **Model access:** Claude Haiku 4.5 access in the account (use-case form, Marketplace).

### Exact commands (owner-run)

Free, read-only checks (no spend):

```bash
aws sts get-caller-identity --profile learning-dev --region us-west-1
aws polly describe-voices --profile learning-dev --region us-west-1 --engine neural --language-code en-US --query 'Voices[].Id'
aws bedrock get-inference-profile --profile learning-dev --region us-west-1 --inference-profile-identifier us.anthropic.claude-haiku-4-5-20251001-v1:0 --query 'status'
aws bedrock get-guardrail --profile learning-dev --region us-west-1 --guardrail-identifier <guardrail-id> --guardrail-version <n> --query 'status'
```

Polly smoke (paid, about 65 characters; memory storage needs no bucket, S3 variant after the
bucket exists). From the repository root:

```bash
cd lai && export AWS_PROFILE=learning-dev DJANGO_SETTINGS_MODULE=config.settings.local && python manage.py migrate && python manage.py seed_speech_voices
```

```bash
cd lai && AWS_PROFILE=learning-dev LAI_SPEECH_PROVIDER=polly LAI_SPEECH_AWS_REGION=us-west-2 LAI_SPEECH_STORAGE=memory LAI_SPEECH_GLOBAL_DAILY_CHARS=500 python manage.py speech_live_smoke --confirm-live-aws --profile pirate-pip --save-mp3 /tmp/pip.mp3
```

```bash
cd lai && AWS_PROFILE=learning-dev LAI_SPEECH_PROVIDER=polly LAI_SPEECH_AWS_REGION=us-west-2 LAI_SPEECH_STORAGE=s3 LAI_SPEECH_BUCKET=learning-adventure-island-dev-speech LAI_SPEECH_DELIVERY=s3 LAI_SPEECH_GLOBAL_DAILY_CHARS=500 python manage.py speech_live_smoke --confirm-live-aws --profile pirate-pip
```

Bedrock (paid, at most 9 calls). Preferred on the deployed host (`docs/AI_BEDROCK_ACCEPTANCE.md`
section 2). For a local run with `learning-dev`, first a synthetic test family and a hybrid Pip
on a fresh local database:

```bash
cd lai && python manage.py shell -c "from apps.users.models import ParentAccount; from apps.users import services; p = ParentAccount.objects.get_or_create_for_cognito('dev-acceptance-parent'); c = services.create_child_profile(p, nickname='Tester', age_band='PATHFINDER', avatar_key='FOX', reading_mode='READ_ALONG', session_minutes=10, interests=[]); print(c.pk)"
```

```bash
cd lai && python manage.py load_content && python manage.py seed_treasure_rush && python manage.py seed_npc_pip --hybrid-hints --publish
```

```bash
cd lai && AWS_PROFILE=learning-dev LAI_AI_PROVIDER=bedrock LAI_AI_BEDROCK_REGION=us-west-1 LAI_AI_GUARDRAIL_ID=<guardrail-id> LAI_AI_GUARDRAIL_VERSION=<n> python manage.py ai_live_check --dry-run
```

```bash
cd lai && AWS_PROFILE=learning-dev LAI_AI_PROVIDER=bedrock LAI_AI_BEDROCK_REGION=us-west-1 LAI_AI_GUARDRAIL_ID=<guardrail-id> LAI_AI_GUARDRAIL_VERSION=<n> LAI_AI_MAX_OUTPUT_TOKENS=150 LAI_AI_GLOBAL_TURNS_PER_DAY=12 LAI_AI_CHILD_TURNS_PER_DAY=12 python manage.py ai_live_check --confirm-paid-calls --parent-sub dev-acceptance-parent --child <child-uuid> --warm-up --npc --npc-manager-hint --guardrail-probe --timeout-probe
```

Only a full PASS of each command is evidence for its gate. The outputs print outcomes, codes,
sizes, latencies and token counts; never text, child data or credentials. Then the audible
browser checks in runbook section 9 and checklist B7.3 and B8.5.

## 6. Final suite results on `integration/npc-manager-main`

| Gate | Result |
| --- | --- |
| pytest, full repository (PostgreSQL 16, fake AI, fake/disabled speech) | PASS: 3265 passed, 4 skipped (opt-in live Polly test, 3 nginx-only), 0 failed |
| Vitest, full | PASS: 5013 passed, 439 files |
| `npm run typecheck`, Ruff check and format, Prettier, `adr:check` (53 decisions), `makemigrations --check` | PASS |
| `ai_live_check --dry-run` (us-west-1, 0 AWS calls) | Not ready: Guardrail id and version not set (L1) |
| Browser acceptance (Playwright) | NOT RUN on this branch (last green run: PR #4, 63 passed, 0 failed, before the `main` merge) |

## 7. Recommended merge order (owner approval at every step)

1. **Choose between #4 and #18** (they conflict). Recommendation: **#4**. It is a superset (the
   same F-A/F-B/legacy-spec fixes plus the idempotent `end`, no racing `end`, and the pirate
   variant) and was rerun green. Close #18, or port anything from it you prefer.
2. Merge **#2** into `feature/npc-manager`, then **#4** (retarget to `feature/npc-manager` once #2
   is in).
3. Merge **#1** into `feature/npc-manager` (one docs conflict, resolved on the integration branch).
4. Merge `feature/npc-manager` into `main` **through `integration/npc-manager-main`** (it carries
   the 13 conflict resolutions, the ADR-053 renumbering and the catalog merge migration), only
   after owner acceptance and the live gates above.
