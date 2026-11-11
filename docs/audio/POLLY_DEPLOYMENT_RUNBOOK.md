# Amazon Polly speech: deployment runbook (SM-P8-LIVE)

Owner-run. Nothing here has been applied to AWS by Claude. Live verification is **not** complete
until `speech_live_smoke` passes in the target account and the audible checks below are signed off.
Design and code: `docs/audio/AMAZON_POLLY_INTEGRATION.md` (ADR-049). Code: `lai/apps/speech/`.

## 1. What runs where

- Django (`apps.speech`) is the only caller of Polly and S3. The browser only ever sends a
  *reference* to text the server already approved, and receives a short-lived URL.
- Credentials come from the standard AWS credential chain: the runtime IAM role in deployed
  environments. No key goes into settings, environment variables, source or the browser.
- Generated speech is cache in a dedicated private bucket, never the asset library or the Sound
  Library.

## 2. Region selection

Pick a region where Polly offers every voice and engine in `apps/speech/voices.py` (the neural
voices are the ones that matter: Justin, Ivy, Kevin, Matthew, Joanna). `us-east-1` and `us-west-2`
offer the full English neural set; check others with the smoke test, whose `region` / `voice table`
steps compare `DescribeVoices` with the table. Put the speech bucket in the same region
(`LAI_SPEECH_S3_REGION` defaults to `LAI_SPEECH_AWS_REGION`) to avoid cross-region transfer.

## 3. IAM (least privilege, runtime role)

```json
{ "Version": "2012-10-17", "Statement": [
  { "Sid": "Speak", "Effect": "Allow",
    "Action": ["polly:SynthesizeSpeech", "polly:DescribeVoices"], "Resource": "*" },
  { "Sid": "SpeechCache", "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::<speech-bucket>/speech/*" }
] }
```

- Polly has no resource-level permissions for these actions, so `Resource` is `*`.
- `polly:DescribeVoices` is only used by the smoke test; drop it from production if you prefer and
  run the smoke test with a separate operator role.
- Objects are written with `ServerSideEncryption=AES256` (SSE-S3), so no KMS permission is needed.
  If the bucket policy requires SSE-KMS, add `kms:GenerateDataKey` and `kms:Decrypt` on that key
  and change `S3SpeechStorage.put`.
- No `s3:ListBucket`: keys are always known.

## 4. The speech bucket

- Private, **Block Public Access on**, owner-enforced object ownership, no bucket website.
- Keys: `speech/shared/<2 hex>/<sha256>.mp3` (authored lines, shared by every child, rows never
  expire) and `speech/child/<2 hex>/<sha256>.mp3` (a child's own approved text, rows expire after
  `LAI_SPEECH_CLIP_TTL_HOURS`). Keys are hashes only: no child id, name or text.
- Lifecycle: **expire `speech/child/` after 2 days** (backstop for `speech_cleanup`). Do **not**
  put an expiry on `speech/shared/`; if an object there is ever removed anyway, the next request
  for it answers 404, the stale cache row is dropped, and the request after that re-synthesizes.
- Optional: abort incomplete multipart uploads after 1 day (none are made; harmless).
- With `LAI_SPEECH_DELIVERY=s3` the browser fetches presigned URLs directly: add a CORS rule
  allowing `GET` from the app origin. With `django` delivery (default) no CORS rule is needed.

## 5. Environment variables (Django)

| Variable | Value | Notes |
|---|---|---|
| `LAI_SPEECH_PROVIDER` | `polly` | `disabled` (default) is the kill switch; `fake` makes placeholder bytes |
| `LAI_SPEECH_AWS_REGION` | e.g. `us-east-1` | Required with `polly` |
| `LAI_SPEECH_STORAGE` | `s3` | `local` is development only |
| `LAI_SPEECH_BUCKET` | the speech bucket | Required with `s3` |
| `LAI_SPEECH_S3_REGION` | bucket region | Defaults to `LAI_SPEECH_AWS_REGION` |
| `LAI_SPEECH_DELIVERY` | `django` or `s3` | `s3` returns presigned URLs; a signing failure falls back to `django` |
| `LAI_SPEECH_GLOBAL_DAILY_CHARS` | start low, e.g. `20000` | Hard daily ceiling on new synthesis |
| `LAI_SPEECH_CHILD_DAILY_REQUESTS` / `_CHARS` | `300` / `20000` | Per child per day |
| `LAI_SPEECH_TIMEOUT_SECONDS` / `LAI_SPEECH_RETRIES` | `5` / `2` | Per attempt; retries only for throttling, 5xx, timeouts |
| `LAI_SPEECH_PRICE_PER_MCHAR_USD` | e.g. `16` for neural | Labelled estimate in admin, never the bill |
| `LAI_SPEECH_CACHE_VERSION` | `1` | Bump to invalidate every clip (forces re-synthesis and cost) |

No AWS keys. Locally, the smoke test uses whatever the AWS CLI chain finds (`AWS_PROFILE`, SSO).

## 6. Setup order

```bash
python manage.py migrate
python manage.py ensure_speech_roles
python manage.py seed_speech_voices          # keeper-quill, chatty, pirate-pip, narrator, tutor
python manage.py seed_npc_pip --attach-voice  # an existing voiceless Pip gets the pirate-pip voice
python manage.py seed_npc_pip --publish       # publish so the release snapshot carries the voice
python manage.py npc_pregenerate_speech       # optional: warm the shared cache for published lines
```

Schedule `python manage.py speech_cleanup` hourly.

## 7. Live smoke test (opt-in, billable, never in CI)

```bash
LAI_SPEECH_PROVIDER=polly LAI_SPEECH_AWS_REGION=us-east-1 \
LAI_SPEECH_STORAGE=s3 LAI_SPEECH_BUCKET=<speech-bucket> LAI_SPEECH_DELIVERY=s3 \
python manage.py speech_live_smoke --confirm-live-aws --profile pirate-pip --save-mp3 /tmp/pip.mp3
```

Or as a pytest (skipped unless asked):

```bash
LAI_SPEECH_LIVE_AWS=1 LAI_SPEECH_LIVE_REGION=us-east-1 LAI_SPEECH_LIVE_BUCKET=<speech-bucket> \
LAI_SPEECH_LIVE_SAVE_MP3=/tmp/pip.mp3 \
python -m pytest -s lai/apps/speech/tests/test_live_smoke.py -k live_amazon
```

Steps reported PASS / FAIL / WARN: region (the chosen voice and engine are offered), voice table
(WARN lists any allowed voice the region lacks), synthesis (playable MP3), cache (two requests,
one Polly call, read back from the store), presigned URL (fetches `audio/mpeg`, S3 delivery only),
fallback (AWS refuses an invalid voice and it maps to a safe generic error; a voice outside the
table never reaches AWS). The sample clip is removed afterwards unless `--keep`. Exit status is
non-zero on any FAIL. Only a full PASS is evidence for the tracker.

## 8. Costs

Polly bills per character synthesized (check the current AWS pricing page; at the time of
writing roughly USD 4 per million characters standard, 16 neural, 30 generative, 100 long-form;
the first 12 months include a free tier). Cached replays cost nothing in Polly. Every starter voice
is neural. The smoke test synthesizes one ~65-character sample. S3 storage is a few KB per line;
requests and transfer are negligible at this scale. The daily character ceiling
(`LAI_SPEECH_GLOBAL_DAILY_CHARS`) caps worst-case spend: at 500000 neural characters a day the
ceiling is about USD 8 a day. Compare the admin estimate with the AWS bill after the first week.

## 9. Manual audible QA (owner, in a browser)

- [ ] Pirate Pip in Treasure Cove: every line is heard in Justin's voice, from Pip's position,
      with the caption shown first and matching the audio.
- [ ] Keeper Quill, Chatty, narrator and tutor voices sound child-appropriate and well paced.
- [ ] Voice mute and volume in the child's audio settings apply; muted keeps captions.
- [ ] Music ducks under speech and returns.
- [ ] Turning `LAI_SPEECH_PROVIDER=disabled` leaves captions only, with no errors shown.
- [ ] Revoke the role's Polly permission (or use a wrong region): captions remain, no error text.
- [ ] Second visit plays from cache (admin daily totals show hits, no new characters).

## 10. Observability

Logger `lai.speech`: `speech served kind=... profile=... cached=... chars=...`,
`speech failed kind=... profile=... code=... reason=...`, `polly synthesized voice=... ms=...`
and `polly request failed: reason=... code=... attempt=n/m`. Never text, never child ids, never an
AWS error message. Reasons: `throttled`, `timeout`, `connection`, `service`, `access_denied`,
`invalid_voice`, `invalid_input`, `bad_audio`, `storage`, `busy`, `global_cap`. Alarm on
sustained `access_denied` or `throttled`. Admin "daily speech totals" show requests, hits,
misses, characters and failures.

## 11. Rollback

1. Set `LAI_SPEECH_PROVIDER=disabled` and restart: every speech request answers
   `speech_disabled`, games show captions only. No data migration is involved.
2. Optionally disable individual voice profiles in Django Admin.
3. To discard cached audio: bump `LAI_SPEECH_CACHE_VERSION`, or delete `speech/` objects and the
   `SpeechClip` rows (`speech_cleanup` removes expired ones).
4. Code rollback: this work adds no migration; reverting the branch is safe.
