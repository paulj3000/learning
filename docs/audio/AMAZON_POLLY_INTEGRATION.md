# Amazon Polly dynamic narration (SM-P8)

Status: development complete and unit-tested on `feature/sound-manager` (2026-11-03) with a **fake
Polly client**. **No real Polly or Bedrock call has been made, nothing was heard, and live
synthesis is off by default.** Live verification is its own gate (section 11).

Django owns synthesis, authorization, caching and limits. React owns playback, captions and the
controls, through the existing Sound Manager's `voice` channel. AWS credentials never reach a
browser, and no setting here turns synthesis on by itself.

## 1. Audit (SM-P8-01)

| Question | Finding |
|---|---|
| Django AI service | `apps/ai`: Bedrock Converse behind `run_turn`; companion (Chatty) and tutor routes; schema validation, URL / personal-information / boundary rules, the Bedrock Guardrail, audit, limits, fallbacks (ADR-044). Responses are `{turn, source, requestId}`. |
| Where approved text exists | After `run_turn` returns, `turn.spokenText` has passed every check (or is authored fallback text). That is the only AI text eligible for speech. |
| Authored dialogue | NPC dialogue is exported content (`NpcDefinition.source.dialogue`); `load_npc_narration(npcId, nodeId)` already reads a node's authored narration server-side for the AI route. |
| Chatty, tutor | React `requestCompanionTurn` / `requestTutorTurn` (Django when available) return a turn; shown by `CompanionBubble` / `NpcConversation`. No speech existed. |
| Keeper Quill, Storykeeper's Castle | The castle is a Three.js region (`castleTale` extension). Quill's conversation is the shared `NpcConversation`; Chatty narrates story steps. See section 8 on `adventures/storybook`. |
| Audio engine | Sound Manager: `voice` channel (child volume and mute, SM-P5), automatic music ducking (SM-P6), scopes and handles, spatial playback (SM-P7). |
| Captions | None existed. |
| AWS config | Bedrock has `LAI_AI_*`; S3 has asset, photo buckets. No Polly. IAM: runtime role. |
| Dependencies | `boto3` is already a dependency. No new package. |

## 2. Django service (SM-P8-02)

New app `apps/speech`.

- `polly.py`: a small `PollyClient` interface. `FakePollyClient` (deterministic bytes, records calls, scriptable failures) is the default in tests; `Boto3PollyClient` is built lazily so nothing imports boto3 or looks for credentials unless `LAI_SPEECH_PROVIDER=polly`. MP3 output. Explicit connect and read timeouts, bounded retries (`LAI_SPEECH_RETRIES`, throttling / service errors / timeouts only, short backoff). Every failure becomes a `SpeechError` with a stable code and a fixed safe message; no AWS error text, request id or credential ever leaves the process.
- `voices.py`: the explicit allowed list of voice, language and engine combinations, and SSML building (text escaped; `<prosody rate>` only for `standard` and `neural`, plain text for `generative` and `long-form`).
- Region, voice, engine and language are configuration (`LAI_SPEECH_AWS_REGION`, voice profiles); input is limited to `LAI_SPEECH_MAX_CHARS` (default 600, hard cap 3000).
- `LAI_SPEECH_PROVIDER`: `disabled` (default), `fake`, `polly`. Production never defaults to `polly`.

## 3. Voice profiles (SM-P8-03)

Django Admin only (**Spoken dialogue** section). `VoiceProfile`: stable id, display name, Polly voice, language, engine, speaking rate (70 to 130 percent), optional character id, enabled, notes, created and updated by, timestamps. The voice, language and engine fields are drop-downs of the allowed lists and the model refuses unsupported combinations (for example Kevin only supports `neural`). Profile ids cannot change after creation.

Starter profiles (`manage.py seed_speech_voices`, idempotent, never edits an existing one): `keeper-quill` (Matthew), `chatty` (Ivy), `narrator` (Joanna), `tutor` (Kevin). **Authored lines** (`SpeechLine`) hold staff-written text for a profile. Group **Speech editors** (`manage.py ensure_speech_roles`) manages profiles and lines and views clips and totals; there is no publish step.

## 4. Authorized speech API (SM-P8-04)

```text
GET  /api/v1/children/<child_id>/audio/speech/          -> { "enabled": bool }
POST /api/v1/children/<child_id>/audio/speech/          body: { "reference": { ... } }
GET  /api/v1/speech-files/<token>/speech.mp3            signed, expiring audio
```

The request names a **reference**, never text. Three kinds:

| Reference | Resolves to | Voice |
|---|---|---|
| `{"kind":"utterance","id":<uuid>}` | An `ApprovedUtterance` made by the server from a validated AI turn, for this child, unexpired | The route's profile (`chatty`, `tutor`), or the character's profile |
| `{"kind":"line","id":"<line id>"}` | An enabled `SpeechLine` | The line's profile |
| `{"kind":"npcNode","npcId":..,"nodeId":..}` | The authored narration of an NPC node in the catalog | The profile whose character id is the NPC, else `narrator` |

Unknown fields, missing fields, extra text and unknown kinds are 400; unknown, disabled, expired,
another family's and another child's references are the same 404. Child-scoped by the parent's
Cognito token (`ChildScopedAPIView`); 401 without a token; GET and POST only. The text is checked
again with the AI output rules at request time (URL, personal information, boundary language,
length), so a rule tightened after approval still applies (422). If the parent turned AI off, AI
text is not spoken. Failures are `{"error": {"code", "message"}}` with fixed messages:
`speech_disabled` 503, `speech_unavailable` 503, `rate_limited` 429, `speech_rejected` 422,
`not_found` 404, `invalid_reference` 400.

## 5. Cache, storage, delivery (SM-P8-05)

- **Cache key** = SHA-256 over cache version, text, Polly voice, engine, language, speaking rate and (for a child's own AI text) the child id. Authored lines are shared by every child; a child's AI text is never shared across children. Change a voice, engine, rate, language, the text or `LAI_SPEECH_CACHE_VERSION` and new speech is made.
- A **database advisory lock** per key serializes identical concurrent syntheses across processes, and a re-check after the lock means one Polly call serves them all (PostgreSQL; other databases skip the lock).
- **Storage** is its own store (`speech/<2 hex>/<64 hex>.mp3`: a hash, no child id or text in a key): `s3` (private bucket, SSE), `local` (development), `memory` (tests). It is separate from the Asset Library and the photo bucket. Generated speech is **never** added to the Sound Library or promoted automatically; promoting reusable narration to a managed asset is a deliberate staff action (record it as an audio asset in the Asset Library).
- **Delivery**: a signed, expiring Django URL (`LAI_SPEECH_URL_TTL_SECONDS`, 15 minutes), or a presigned S3 URL with `LAI_SPEECH_DELIVERY=s3`. Served `private, no-store`, `nosniff`, sandboxed.
- **Expiry and cleanup**: approved utterances live `LAI_SPEECH_UTTERANCE_TTL_MINUTES` (60); a child's clips `LAI_SPEECH_CLIP_TTL_HOURS` (24); authored clips do not expire. `manage.py speech_cleanup [--dry-run]` removes expired rows and objects (run hourly). Deleting a child purges their clips at once. Sensitive text is not retained longer than the utterance window; no text is ever logged, audited or shown in admin (clips show counts and sizes only).

## 6. Playback, captions and controls (SM-P8-06, SM-P8-07)

`react/src/audio/speech/`:

- `SpeechPlayer` plays through a **scope**, registering each clip as a temporary `voice` sound and releasing it afterwards. So child voice volume and mute, music ducking, spatial placement, handles and scope cleanup are the Sound Manager's, not ours.
- `speak`, `showText`, `stop`, `skip`, `pause`, `resume`, `replay` (asks again; the server answers from its cache with a fresh signed URL), a FIFO queue (`mode: 'queue'`), interruption (default), request aborts, and an in-flight guard so a late response after stop, interrupt, scope disposal or unmount never starts audio.
- `useSpeech` (StrictMode-safe) and `SpeechCaption` (a polite live region, large real buttons, controls shown only when they can act).
- **Captions come first.** The text the child can read shows the moment `speak` is called and again when audio is muted, blocked, offline, slow or failed; the server's approved text replaces it when it arrives, so caption and audio always match. A failure is a quiet "text only" state, never a dialog. **Utterance-level only: there is no word timing and no word highlighting.**

## 7. Bedrock to Polly (SM-P8-08)

```text
child action -> existing AI turn route -> validation + guardrails -> TurnResult
   -> approve_turn(): ApprovedUtterance (child-owned, 60 min) -> { speech: { utteranceId, voiceProfile } }
   -> app: POST speech { reference: utterance } -> Polly (or cache) -> Sound Manager voice channel + caption
```

`approve_turn` runs after the pipeline, never calls Polly, never sees unvalidated model output, re-checks the text with the output rules, skips `STOP` dispositions and AI-off children, and swallows its own failures (the turn is never affected; the reference is simply omitted). The reference is an **additive** field, so older clients ignore it. Polly receives only the approved text and a voice, never a child id, name or session.

## 8. Storykeeper's Castle (SM-P8-09)

`useCastleSpeech` (inside `CastleTaleCompanion`) registers a **speech binding** while the castle is mounted. Shared dialogue components look for a binding and speak only when one exists, so no other world changes.

- **Keeper Quill's conversation** (`NpcConversation`): each node with authored narration is spoken, from Quill's position (2.5 m full volume, 20 m range) through the shared spatial engine; with AI on, the re-voiced Chatty line is spoken from the server's approved reference, in Quill's voice profile when one is configured (`character_id`).
- **Story narration and instructions** (Chatty's turns in the tale and the secret-door story) are **flat**, so every child hears them clearly. Essential instructions never depend on position or on audio.
- Captions, replay, skip, pause and music ducking come from `SpeechCaption`, the voice channel and the Sound Manager.
- Story progression, rewards and objectives are untouched.

**Branch note.** `origin/adventures/storybook` is 33 commits ahead and reworks the castle (new layout, rooms, map; it also changes `CastleTaleCompanion.tsx`, `castleTaleScene.ts` and `storykeeperCastleRegion.ts`). It was **not merged**. The castle integration here is small and additive: `useCastleSpeech.tsx` (new), a `quillPositionReader` on the castle scene API, a hook call and a caption in `CastleTaleCompanion`. When that branch lands, expect a mechanical conflict in `CastleTaleCompanion.tsx` and `castleTaleScene.ts`; the resolution is to keep both sets of changes.

## 9. Chatty and the tutor (SM-P8-10)

Adapters in `audio/speech/adapters.ts`: `speakCompanionTurn`, `speakTutorTurn` (from a turn result and its optional `speech` reference; no reference means text only), `speakLine` (staff-written lines) and `speakNpcNode`. They are wired into `useCompanionTurn`, `useTutorTurn` and `NpcConversation` through the speech binding, so a game enables speech by registering a binding (see `useCastleSpeech`), and does nothing otherwise. Feature flags: the server (`LAI_SPEECH_PROVIDER`, per-voice enabled), the child (`ai_enabled`), and the game (binding registered).

To enable speech in another game: (1) create or enable the voice profile(s) in Admin; (2) call `useSpeech`, render `SpeechCaption`, and register a `SpeechBinding` while mounted; (3) keep essential narration flat and pass a `position` only for a character's conversational lines.

## 10. Operational safeguards (section 25 of the brief)

| Control | Where |
|---|---|
| Per-child daily requests and characters | `LAI_SPEECH_CHILD_DAILY_REQUESTS` (300), `LAI_SPEECH_CHILD_DAILY_CHARS` (20000): both counted per child per day (cached replies count too, so a child cannot spin the cache for free); beyond either the answer is 429 `rate_limited` |
| Global daily characters | `LAI_SPEECH_GLOBAL_DAILY_CHARS` (500000): beyond it new synthesis answers `speech_unavailable` and cached speech still plays |
| Concurrency | `LAI_SPEECH_MAX_CONCURRENT` (4), per process, non-blocking: a busy process says so rather than queueing |
| Allowed voices and engines | `voices.py` table, enforced on save and again at synthesis |
| Kill switch | `LAI_SPEECH_PROVIDER=disabled` (default); per-voice `enabled` |
| Metrics | `SpeechDailyTotal` (requests, hits, misses, characters synthesized, failures) and `SpeechUsage` per child per day; counts only |
| Cost | `LAI_SPEECH_PRICE_PER_MCHAR_USD` times characters synthesized, shown as **"Estimated cost (an estimate, not a bill)"**, empty when unset. It is application-side only and is not the AWS bill. |
| Logs | Counts, codes and AWS error codes only; never text, never child ids |

**IAM (least privilege) for the runtime role**, to apply by hand (nothing was changed in AWS):

```json
{ "Version": "2012-10-17", "Statement": [
  { "Effect": "Allow", "Action": ["polly:SynthesizeSpeech", "polly:DescribeVoices"], "Resource": "*" },
  { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::<speech-bucket>/speech/*" }
] }
```

The speech bucket must be private, block public access, and have a lifecycle rule that expires `speech/child/` objects after a few days as a backstop for `speech_cleanup` (never `speech/shared/`, whose rows do not expire). `polly:DescribeVoices` is only for the live smoke test. Polly does not support resource-level permissions for `SynthesizeSpeech`.

## 11. Live verification gate (open)

**SM-P8-LIVE (2026-11-07, branch `feature/sm-p8-live-polly`).** The real client path is complete
and unit-tested against botocore's Stubber: MP3 and size checks on Polly's answer, classified
errors (`SpeechError.reason`), bounded retries only for throttling, 5xx, timeouts and dropped
connections, no retry for IAM, credential, voice or input errors, S3 with an explicit region and
SigV4, scope-prefixed keys (`speech/shared/`, `speech/child/`) for lifecycle rules, presign
failure falling back to Django delivery, a missing object invalidating its cache row, structured
log lines without text, the `pirate-pip` starter voice (Justin, neural) and
`seed_npc_pip --attach-voice`. Deployment, IAM, bucket, cost, smoke test, audible QA and rollback:
`docs/audio/POLLY_DEPLOYMENT_RUNBOOK.md`.

**Live result: FAIL / not verified.** `speech_live_smoke` was run once from the development
container on 2026-11-07 (us-east-1, pirate-pip, memory storage): AWS answered
`UnrecognizedClientException` to `DescribeVoices` and `SynthesizeSpeech` (the container's
credentials are not valid AWS credentials). Nothing was synthesized and nothing was heard. Still
open: a passing `speech_live_smoke` in the target account (region, synthesis, cache, S3 read-back,
presigned delivery, AWS fallback), audible quality of each voice, the voice / engine table against
current AWS documentation, the bucket and IAM policy, Bedrock turns producing references end to
end, cost against the AWS bill, and child-appropriate pacing. Tracker item **SM-P8-LIVE** stays
open until the owner does these.

## 12. Limits

- Utterance-level captions only; no timing data exists.
- Pausing leaves music ducked (the voice handle is still alive).
- A Quill node without authored narration is text only; only nodes with a `narration` block are spoken.
- Speech needs the Cognito bearer; a game opened only with the runtime cookie is text only.
- Voices are English only for now; the table is hand-maintained.
- Tests use a fake client or the real client over botocore's Stubber, a fake engine and an in-memory store. Nothing was heard.
