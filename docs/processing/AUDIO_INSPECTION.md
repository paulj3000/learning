# Audio inspection (`asset.process_audio`, LAI-LAMBDA-008 phase 1)

Status: developer-complete on the Wave 4 integration branch `feature/serverless-processing-wave4`
(from `feature/w4-audio-inspection`, on the reviewed canonical PR #42 head), 2026-11-17. Not merged
to `main`, not deployed; transcoding is not authorized. Local end-to-end run:
`scripts/processing/local-demo.sh` steps 11, 12, 14, 15 and 16 (packaged worker zip, in-memory SQS
and S3). Phase 2
(transcoding and loudness) is a proposal only:
`proposals/ADR-PROPOSED-native-audio-transcoding.md`.

Phase 1 reads an audio file's container and codec headers in the standard library, inside the
existing jobs worker zip, and reports what it finds to staff. It does not decode, transcode,
normalise, write files, publish or change any version. It runs only when a staff member asks for
it; nothing submits it on upload, and `LAI_ASSET_ASYNC_VALIDATION` does not apply to audio.
Child speech and recordings never use it, and Polly speech (`speech.synthesize`) is untouched.

Phase 2 (transcoding and loudness, `asset.transcode_audio`, LAI-LAMBDA-008b) is a separate kind
on its own `audio` queue with an LGPL FFmpeg layer (ADR-067, `AUDIO_TRANSCODING.md`); it reuses
this inspector's sniffing for its input check. Header inspection stays standard-library and does
not decode audio.

## 1. Where it fits

| Piece | Where |
|---|---|
| Job type (closed catalog, LAI-LAMBDA-008) | `processing/lai_processing/contracts/job_types.py` |
| Processor `asset.audio_inspector` 1.0.0, profile `audio-inspect` v1 | `processing/lai_processing/processors/audio/` |
| Registered | `processing/lai_processing/core/registry.py` (`default_registry`) |
| `apps.jobs` kind on the media queue | `lai/apps/jobs/core/envelope.py` (`ASSET_PROCESS_AUDIO`, `KIND_QUEUE`), `core/tasks.py` (`RUNNERS`), `core/contract.py` (`CONTRACT_KINDS`), `models.py` (`JobKind`), migration `jobs.0004_wave4_inspection_kinds`, shared with `asset.analyze_animation` (choices and check constraint only) |
| Handler (`apply`, `inline_ports`) | `lai/apps/audio/inspection.py`, registered in `lai/apps/jobs/services.py` (`HANDLER_MODULES`) |
| Worker ports | `lambda/jobs_worker/aws.py` (`AssetPorts`, read only); the library is vendored by `lambda/build.py` unchanged |
| Admin | `lai/apps/audio/admin.py`: "Audio files (inspection)" (`AudioFile`, a proxy over audio `AssetVersion` rows, migration `audio.0005_audio_file_proxy`) and the Sound cue page |
| Permission | `audio.inspect_audiofile` (and `audio.view_audiofile` to list files); granted to Sound editors and Sound publishers by `manage.py ensure_sound_roles` |

Sound Manager audio files are Asset Library versions (`apps.assets.AssetVersion`, format `mp3`,
`wav` or `ogg`). A cue points at an asset; `apps.audio.services.version_for(cue)` resolves the
pinned or default version. Inspection always names one exact version.

## 2. Reuse decision

The processor is a new standard-library module, informed by (not importing) the two existing
audio readers:

| Existing code | Why it is not the processor |
|---|---|
| `lai/apps/assets/validation_media.validate_audio` (upload gate) | Imports Django settings and the asset validator; it is an accept-or-refuse gate that stops at the first error; it does not read Xing/VBRI, Opus pre-skip, chained or multiplexed Ogg, extensible WAV, or Ogg checksums past the first 16 pages and the last. Its limits (mono or stereo, 8 to 96 kHz, 15 minutes, 20 MiB) are kept as the inspector's `UPLOAD_POLICY` warnings and as the profile's input ceiling |
| `lai/apps/jobs/core/probe.py` (`asset.inspect`) | Reads only the first 256 KiB, never walks the stream, and its CBR duration is a byte-count estimate even for VBR files. It stays as is for `asset.inspect` |

`lai_processing` must not import Django or `apps.*` (the worker zip refuses it), so porting the
logic was the only way to put it in the zip. The bit-rate and sample-rate tables match both.

## 3. Submission and identity

`apps.audio.inspection.submit_audio_inspection(version, user=)`:

1. Refuses a non-audio version (`not_audio`).
2. Builds the ADR-061 request: subject `("asset_version", <version uuid>)`, asset context (asset
   id, version uuid, number), input `ObjectRef("assets", <storage key>, None)`, declared content
   type, size and SHA-256 from the version row, profile `audio-inspect` v1, execution budget 90 s
   (`apps.assets.processing.MAX_EXECUTION_SECONDS`, inside the 120 s media function), expiry 72 h.
   The contract refuses a version above 20 MiB (`resource_limit_exceeded`) before any job exists.
3. The `ik1:` idempotency key covers namespace, job type, subject, profile, input (store, key,
   SHA-256, size, content type), options and processor version. A job with the same key that is
   pending, running, or completed with outcome `inspection_recorded` is returned instead of a new
   one. A failed job, or a completed one whose result was refused, may be submitted again.
4. Submits through `apps.jobs.services.submit` (media queue, transactional outbox). The job
   subject is `assets.assetversion` and the version's primary key.

`apply(job)` (consumer or inline backend, once, under the job row lock):

| Check | Outcome code when it fails |
|---|---|
| Job completed | `processing_failed` |
| The result is a valid ADR-061 result of exactly the request (job, attempt, key, type, namespace, profile, verified input): `apps.assets.processing.result_mismatch` | `result_invalid`, `job_mismatch`, `attempt_mismatch`, `key_mismatch`, `identity_mismatch`, `profile_mismatch`, `input_mismatch` |
| The result's job type is `asset.process_audio` | `identity_mismatch` |
| The version still exists | `version_missing` |
| The request still describes the version as it is now (`identity_mismatch`): kind, subject, namespace, asset context, storage key, no object version, SHA-256, size, content type, profile | `kind_mismatch`, `subject_mismatch`, `namespace_mismatch`, `asset_mismatch`, `storage_mismatch`, `checksum_mismatch`, `size_mismatch`, `content_type_mismatch`, `profile_mismatch` |
| All pass | `inspection_recorded` |

Duplicate and late result messages are ignored by `services.apply_result` (the job is already
terminal), so `apply` runs once. **The version is never written**, whatever its status: audio
versions are created `VALIDATED` by the synchronous upload checks and become immutable once
published (`AssetVersion.IMMUTABLE_FIELDS`), and phase 1 has no state to move a version into. The
result stays on the job (`ProcessingJob.result`), as for `asset.inspect`. Whether results should
ever become version metadata, or audio join `ASYNC_FORMATS`, is owner decision W4-5.

## 4. Admin

- **Audio files (inspection)** lists audio versions only (read only: no add, change or delete;
  upload, publish and retire stay in the Asset Library). Viewing needs `is_staff` and
  `audio.view_audiofile` or `audio.inspect_audiofile`.
- **Inspect audio in background** (on Audio files and on Sound cues, where it inspects each cue's
  resolved version) needs `is_staff` and `audio.inspect_audiofile`. It reports an existing waiting,
  running or recorded job instead of submitting again, and submits a new job after a failed or
  refused one.
- Each file page and each cue page shows the latest inspection: a status sentence, the job's
  status, outcome, times and error code, a link to the existing background job page
  (`admin:jobs_processingjob_change`, where a stuck job can be failed), and a read-only result
  panel (verdict, format, container, codec, declared type, duration and its kind, sample rate,
  channels, sample width, bit rate and mode, findings, limitations). Every value is rendered with
  `format_html`, so file-derived or tampered values are escaped. A result that does not match the
  version's current file, or that was refused, is not shown as a result.
- Nothing here publishes, changes a cue or a release, or writes a version.

## 5. What the inspector reads

Format detection uses the leading bytes only (`sniff`): `RIFF`/`RIFX`/`RF64`/`BW64` + `WAVE`,
`OggS`, `ID3` or a valid MPEG audio frame header. FLAC, AIFF, MIDI, AMR, ASF, Matroska and MP4
are recognised by signature and refused as unsupported; anything else is `not_audio`. The
declared content type is compared afterwards: an unknown audio type is a warning, a non-audio type
(`declared_type_not_audio`) and a disagreement with the bytes (`declared_type_mismatch`) are
errors.

### WAV (`wav.py`)

RIFF header (declared size versus file size: `wav_truncated`, `trailing_data`; RF64 and RIFX are
refused), then a chunk walk bounded by `max_wav_chunks` (1,024): printable chunk ids, lengths
checked against the RIFF end, odd lengths followed by their pad byte (a missing final pad byte is
a warning). `fmt ` (at least 16 bytes; `WAVE_FORMAT_EXTENSIBLE` sub-format GUID checked), `fact`
(sample frames) and `data` (duplicates are errors; a length past the end, including the streaming
`0xFFFFFFFF`, is `wav_data_truncated`). Codecs: PCM (8, 16, 24, 32 bit) and IEEE float (32, 64 bit)
are playable; A-law, mu-law, ADPCM, GSM, MPEG and unknown tags are reported and refused
(`wav_codec_unsupported`). Block alignment must match channels and sample size; a byte-rate
mismatch is a warning. Duration: sample frames / rate, `exact` (from the available bytes and
`estimated` when truncated); for other codecs the `fact` count (`exact`) or bytes / byte rate
(`estimated`).

### MP3 (`mp3.py`)

Up to 4 leading ID3v2 tags are skipped (synchsafe sizes checked, total at most `max_id3_bytes`,
8 MiB). A trailing ID3v1 tag and an APEv2 tag up to 1 MiB are excluded from the audio. The first
frame is searched for within 64 KiB and confirmed by a second matching header. MPEG 1, 2 and 2.5,
Layers I to III are parsed; only Layer III passes (`mp3_layer_unsupported`), and free format
(bit-rate index 0) is refused because its frames cannot be walked without decoding. A Xing, Info
or VBRI header in the first frame gives the frame count. The frame walk (at most `max_mp3_frames`,
200,000) checks that version, layer and sample rate never change, notes channel-mode changes,
treats a short last frame as a warning and anything unreadable after the frames as
`trailing_data` (zero padding is a warning).

| Case | Duration | Kind |
|---|---|---|
| Xing, Info or VBRI frame count | frames x samples per frame / rate | `exact` (a mismatch with the walked frames is a warning) |
| No count, walk complete | walked audio frames x samples per frame / rate | `estimated` |
| No count, walk stopped at its limit | audio bytes x 8 / average walked bit rate | `estimated` |
| Free format | none | `unavailable` |

A variable bit rate without a Xing or VBRI header is the warning `mp3_vbr_without_header` and the
limitation `mp3_vbr_estimate`; constant bit rate without a header gets `mp3_cbr_estimate`. Encoder
delay and padding (LAME gapless data) are never subtracted (`mp3_encoder_delay`).

### Ogg (`ogg.py`)

Pages are walked from the start, at most `max_ogg_pages` (50,000): capture pattern, version 0,
reserved flags, lacing table and body length within the file. CRC-32 (polynomial `0x04C11DB7`) is
verified on the first 16 pages and the last page. Each logical stream is tracked by serial: codec
from the first packet of its beginning-of-stream page (Vorbis, Opus; FLAC, Speex, Theora, Skeleton,
Kate, PCM, VP8 and OGM video are recognised and refused as `ogg_codec_unsupported`), page sequence
(a gap is a warning), granule positions (out of range is an error, decreasing a warning) and the
end-of-stream flag (missing: `ogg_no_end_of_stream`). Several streams at once are
`ogg_multiplexed` (error); streams one after another are `ogg_chained` (warning; the duration is
the sum of the links). Vorbis: identification header version 0 and framing bit, channels, rate,
nominal bit rate. Opus: major version 0, channels, pre-skip, input rate, mapping family (family 0
allows at most two channels). Duration: last granule / rate (Vorbis), (last granule - pre-skip) /
48,000 (Opus), `exact` after a complete walk; after a capped walk the last page is found backwards
from the end of the file and the duration is `estimated`. Average bit rate is file bytes x 8 /
duration.

## 6. Result metadata (`metadata_version` 1)

Every key is always present. Deterministic: the same bytes and declared type give byte-identical
canonical JSON. No names, timestamps, paths or text from the file, except four-character RIFF
chunk ids reduced to `[A-Za-z0-9 _-]` (anything else becomes `?`). See `CONTRACTS.md`, "Audio
inspection metadata".

Findings use codes (section 5) and code-authored messages with index paths only (`page[3]`,
`frame[120]`, `stream[1]`, `chunk[2]`, `id3v2[0]`), at most 100 plus a `too_many_findings` summary
whose severity is `error` if any dropped finding was. The verdict is `fail` when any finding is an
error, `pass` otherwise. Run warnings: `mp3_scan_limit`, `ogg_scan_limit`.

`UPLOAD_POLICY` warnings (`channels_outside_upload_policy`, `sample_rate_outside_upload_policy`,
`duration_outside_upload_policy`, `audio_empty`) repeat the Asset Library's upload limits; they do
not fail the verdict.

## 7. Limitations (stated in every result)

- `header_only`: header inspection does not decode audio, so it does not prove the file is
  decodable.
- `playback_not_verified`: it does not prove the file plays in every browser or device.
- `loudness_not_measured`: it does not measure loudness, peak level, clipping or silence.
- Format-specific, when they apply: `mp3_encoder_delay`, `mp3_cbr_estimate`, `mp3_vbr_estimate`,
  `mp3_free_format`, `ogg_crc_sampled`, `ogg_chained`.

Also known and documented here: a VBR MP3 whose Xing count is wrong is trusted (with a warning
only when the full walk disagrees); MPEG frame sync can be fooled by data that happens to contain
valid-looking headers (the second-header confirmation reduces this); free-format MP3 cannot be
measured; truncated MP3 streams lose at most the last frame silently from the duration; Ogg
checksums of middle pages are not verified; a capped Ogg walk does not check the pages it skipped.

The inspector also flags Ogg files the upload check accepts: `validation_media._check_ogg` does
not read the full Vorbis identification header (the Asset Library's own minimal test Ogg fails
inspection for that reason; see `lai/apps/audio/tests/test_audio_inspection.py`).

Ogg checksums at upload (fixed 2026-11-17): the upload check used to read each page's CRC field
without verifying it, so a damaged Ogg passed upload and only this inspection caught it. It now
verifies the same sample as the inspector (the first 16 pages and the last page, error
`ogg_crc`), using the shared `lai_processing.processors.audio.ogg.ogg_crc`. Ogg files uploaded
before the fix are not re-validated; run this inspection on them to find damaged ones.

## 8. Bounds

| Bound | Value |
|---|---|
| Input (profile `max_input_bytes`) | 20 MiB, the Asset Library audio ceiling (`LAI_ASSET_MAX_AUDIO_BYTES` default); checked by the contract at request time, by the engine before copying, and by the processor |
| Execution | 90 s requested (engine-enforced, cooperative `context.check()` every 512 reads) |
| WAV chunks / MP3 frames / Ogg pages | 1,024 / 200,000 / 50,000 (complexity limits, clamped by the worker) |
| ID3v2 | at most 4 tags, 8 MiB in total |
| First-frame search | 64 KiB |
| Single read | at most 128 KiB, served from a 64 KiB window |
| Integers | granules above 2^53 are refused; durations above 2^53 s are `unavailable`; sample rates above 768 kHz are refused |
| Findings, streams, chunk ids listed | 100, 8, 32 |

## 9. Tests

| Tests | Command |
|---|---|
| Library (71 cases: WAV, MP3, Ogg, detection, declared type, bounds, determinism, engine) | `PYTHONPATH=processing python -m pytest tests/processing/test_processing_audio_inspector.py` |
| Packaged worker (each format through `jobs_worker.handler` from the staged zip) and zip contents | `python -m pytest tests/lambda/test_jobs_worker_audio.py tests/lambda/test_jobs_worker_package.py` |
| Django (submission, idempotency, duplicates, stale versions, immutability, admin, permissions, escaping) | `LAI_REQUIRE_POSTGRES=1 python -m pytest lai/apps/audio/tests/test_audio_inspection.py` |

Fixtures are synthesised in `tests/processing/audio_builder.py` (with an independent bit-by-bit
Ogg CRC); no binary files are committed.

## 10. Rollout

Consumer first, as for every kind (`WAVE4_HANDOFF.md` section 3): the worker zip that knows
`asset.process_audio`, Django's migration and handler ship in the same release, and no one uses
the admin action until both are deployed. No flag is needed because nothing submits the kind
automatically. Live verification belongs to LAI-LAMBDA-011 and needs owner approval.
