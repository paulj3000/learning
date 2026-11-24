# Audio transcoding and loudness (LAI-LAMBDA-008b): design

Status: **phase 1 implemented (native runtime, build, processor, worker); Django and Sound Manager
integration is phase 2** (2026-11-18). Accepted by the owner for LGPL FFmpeg, Opus primary, MP3
alternative, zip function plus layer, own `audio` queue, artifacts via ADR-066:
`adr/ADR-067-audio-transcoding.md`. Nothing is deployed; no arm64 build or Lambda measurement
exists yet. Where this page and the ADR differ, the ADR wins.

What exists: `native/ffmpeg/` (reproducible LGPL build, licences, SBOM, README),
`processing/lai_native/runtime/` (shared native tool runner), `processing/lai_native/audio/`
(profiles, FFmpeg commands, processor, engine adapter), `lambda/audio_worker/` (handler, storage
seam, deterministic zip), tests in `tests/processing_native/` and `tests/lambda/test_audio_worker.py`,
and `scripts/processing/bench/audio_native_bench.py`. Phase 1 inspection (`asset.process_audio`)
is in `AUDIO_INSPECTION.md`.

**Changes from the original design below:** profile ids are `audio-sfx|ui|ambient|music|voice`
(version 1, no `-v1` suffix); the interface profile's alternate is MP3, not WAV (artifact content
types are `audio/ogg` and `audio/mpeg` only); the profile module lives in
`lai_native.audio.profiles`; no `ffprobe` is shipped; the processor is `asset.audio_transcoder`
inside the ADR-061 engine; the per-output pipeline is described in section 9. Sections 4 and 5
(Sound Manager flow, artifact needs) are phase 2 and remain design.

## 1. Scope

Staff-authored Sound Manager audio only (Asset Library audio versions, 20 MiB and 15 minutes at
most). Never child speech, recordings, photos or any child data. Polly speech is out of scope.
A transcode produces candidate files for staff to review; it never changes, publishes or
replaces anything by itself.

## 2. Processing contract and profiles

### Job type and request

Proposed job type `asset.transcode_audio` (**not** in `JOB_TYPES`; adding it is a 008b task after
the ADR is accepted, with `owner_task="LAI-LAMBDA-008"`). It uses the ADR-061 schema-1 request
unchanged: subject `("asset_version", <uuid>)`, asset context, input `ObjectRef("assets", key,
None)` with declared SHA-256, size and content type, `ProfileRef(<profile id>, <version>)`, budget
and expiry. Options are the profile's `OptionSpec`s; the proposal has **none** beyond the profile
(`outputs`: `all` or a label list is the only candidate), so staff cannot free-type a loudness
target; a new target is a new profile version (decision A-9).

The idempotency key (`ik1:`) additionally covers the processor version and the **FFmpeg build
SHA-256**, so a new binary never reuses an old result.

### Result (schema 1 `ProcessingJobResult`, metadata keyed by facts, never by free text)

| Field | Meaning |
|---|---|
| `source` | The Phase 1 facts the job relied on (format, codec, duration, rate, channels) and the input SHA-256 |
| `measured_before` | Integrated LUFS, true peak dBTP, loudness range LU, sample peak dBFS, short-term maximum LUFS |
| `gain_db` | The single linear gain applied (never dynamic compression in v1) |
| `outputs[]` | Per profile output: label, codec, container, sample rate, channels, bit rate, duration ms, size, SHA-256, `measured_after` (same measures), and an `ArtifactReference` under `processing/artifacts/` |
| `tool` | Name, version, build SHA-256 and licence class (`lgpl`) |
| `findings[]` | Codes below, each with a severity |

Finding codes proposed: `loudness_target_missed`, `true_peak_retry`, `clipping_in_source`,
`short_term_too_loud`, `silent_source`, `duration_drift`, `output_reinspection_failed`,
`decoder_warning`. Failures reuse the typed `ErrorCode` classes (a new code, for example
`native_tool_failed`, is a 008b task): a decode error or a refused input is PERMANENT; a timeout
or out-of-memory is RETRYABLE once; a pinned-binary checksum mismatch is MANUAL.

### Processing steps

1. Gate: a recorded phase 1 inspection for this exact version with verdict `ok` or warnings only.
2. Fetch and verify SHA-256, sniff the format with the phase 1 `sniff()`, write to a per-job `/tmp`
   directory.
3. Pass 1 (measure, `-f null`): `loudnorm ... print_format=json` for integrated profiles,
   `volumedetect` for peak profiles.
4. Gain: `linear_gain_db` (integrated: the smaller of the loudness need and the true-peak
   headroom) or the peak difference. Never boost beyond +20 dB (a source that quiet is flagged
   `silent_source` and refused).
5. Pass 2: encode each output with one `volume=<gain>dB`, resample and channel settings, metadata
   stripped.
6. Measure each output again. For lossy outputs, true peak above the ceiling after encoding is
   retried with 0.5 dB less gain, at most twice, then flagged (`true_peak_retry`, or an error).
7. Re-inspect each output with the phase 1 inspector (format, codec, rate, channels, duration
   within the pre-skip and frame tolerance of the source), then write artifacts create-only.

### Per-category profiles (proposals, owner decision A-4)

Categories are the Sound Manager channels (`lai/apps/audio/vocabulary.py`), with authored
dialogue as `voice`. Every output is mono or stereo, 16-bit where applicable, metadata-free.

| Profile | Channel | Level target | True peak | Primary output | Alternate output | Why |
|---|---|---|---|---|---|---|
| `audio-voice-v1` | voice | -16 LUFS integrated, LRA at most 12 LU, tolerance 1 LU | -1 dBTP | Ogg Opus 48 kHz mono 48 kbit/s | MP3 44.1 kHz mono CBR 64 kbit/s | Narration must stay intelligible on phone and tablet speakers. -16 LUFS is the common speech target for streaming on mobile; mono suits speech and positional (spatial) cues, and Opus in voice mode is transparent for speech near 32 to 48 kbit/s |
| `audio-music-v1` | music | -18 LUFS, LRA at most 20 LU | -1 dBTP | Ogg Opus 48 kHz stereo, preset `high` (96 kbit/s) | MP3 44.1 kHz stereo VBR V4 | Sits 2 LU under voice, so narration stays on top before the mixer's channel volumes and ducking apply; wide range kept for music |
| `audio-ambient-v1` | ambient | -20 LUFS, LRA at most 15 LU | -1 dBTP | Ogg Opus 48 kHz stereo, preset `standard` (64 kbit/s) | MP3 44.1 kHz stereo VBR V5 | Loops and beds should be felt, not noticed; lower than music; 64 kbit/s is enough for noise-like textures. Loop points: encoders add priming and padding, so seamless loops are a review item, see section 4 |
| `audio-sfx-v1` | sfx | Peak -3 dBFS, no integrated target; report any 3 s short-term level above -14 LUFS | n/a (sample peak, then re-measured true peak must stay at or below -1 dBTP after encode) | Ogg Opus 48 kHz source layout, preset `standard` | MP3 44.1 kHz CBR 128 kbit/s | Integrated loudness is not meaningful for clips of a few seconds; the ceiling and flag protect children from sudden loud sounds. Inputs capped at 30 s |
| `audio-ui-v1` | ui | Peak -6 dBFS, flag above -18 LUFS short-term | as sfx | Ogg Opus 48 kHz mono, preset `low` (48 kbit/s) | 16-bit WAV 48 kHz mono (clips of 10 s or less) | Interface sounds repeat often; they sit below effects. WAV avoids encoder pre-skip on tiny clips |

The measures, units and validation rules are in `audio_profiles.py` (`validate_profile`
returns every problem; the defaults are validated at import). Configurable per profile:
`integrated_lufs` (-30 to -9), `true_peak_dbtp` (-9 to -0.1), `peak_dbfs` (-24 to -0.1),
`lra_max`, tolerance, sample rate (Opus 16, 24 or 48 kHz; MP3 and WAV 22.05 to 48 kHz), channels,
`bitrate_kbps` or a quality preset (`low`, `standard`, `high`), VBR for MP3. These numbers are
reasoned proposals; the bench and staff listening confirm or change them, and a change is a new
profile version (profile versions never change once used, `profiles.py`).

Reduced-intensity play (`ChildAudioSettings.reduced_intensity`) stays a playback setting, not a
second encode.

## 3. Processing security design

| Control | Design |
|---|---|
| Inputs | Staff Asset Library audio versions only; never child content; declared SHA-256 verified before use; phase 1 inspector as a pre-gate (errors mean no transcode); format from `sniff()` of the bytes, passed to FFmpeg as an explicit `-f wav\|mp3\|ogg`, never from a name or type |
| Executable | One FFmpeg binary at a fixed path in the layer (`/opt/bin/ffmpeg`), its SHA-256 recorded in a lock file in the function package and checked before the first run of each execution environment; mismatch fails MANUAL and runs nothing. No `ffprobe`, no PATH lookup, no other binary. Process execution lives in one runner module outside `lai_processing`; a guard test fails the build if any other module imports `subprocess` |
| Invocation | Argv list, `shell=False`, never an interpolated string. Flags are constants; the only variable elements are two absolute paths inside the per-job directory, placed after `-i` and last, validated to start with `/` and not `-`. `-nostdin -hide_banner -nostats -n` (create-only) |
| Environment | Empty environment for the child (the Lambda environment holds AWS credentials and the queue URLs); working directory is the job directory |
| Network | No network use by construction: `-protocol_whitelist file`, and a build with only the `file` protocol. Lambda outside a VPC has egress, so the whitelist and the minimal build are the control; a VPC without NAT is a stronger option (A-6) |
| Streams | `-map 0:a:0 -vn -sn -dn`: only the first audio stream; embedded video, subtitles and data are dropped |
| Metadata | `-map_metadata -1 -map_chapters -1`, `-write_id3v2 0` (MP3), bitexact flags: no tags, cover art or encoder strings from the source survive |
| Bounds | Input at most 20 MiB and 900 s (`-t`); output `-fs` at most 20 MiB; wall-clock kill at 240 s; memory by the function's size; `RLIMIT_CPU`, `RLIMIT_FSIZE` and `RLIMIT_AS` set on the child; at most 3 outputs, run one at a time |
| Files | Per-job directory under `/tmp` created 0700 and removed in a `finally`; nothing outside it is read or written; outputs are copied out only after re-inspection |
| Privilege | Function role: read the asset bucket `assets/audio/` only; write `processing/artifacts/` create-only; send to the results queue; receive its own queue; no database, no publish, no other bucket (ADR-061). Nothing here publishes |
| Logging | No file names, durations of named content or tool stderr beyond a fixed set of codes; FFmpeg stderr is parsed for numbers and never stored (ADR-025 logging rule) |
| Review | Every result is advisory until a staff member listens and promotes it (section 4); promotion and publication stay separate, permission-checked actions (ADR-045) |

## 4. Sound Manager Admin design (staff flow)

Built on the phase 1 pages ("Audio files (inspection)" and the Sound cue page,
`lai/apps/audio/admin.py`). New permission `audio.transcode_audiofile` (proposed: Sound editors),
promotion needs the existing add-version permission, publication stays with Sound publishers.

1. **Request transcode.** Action on an audio file and on a cue. Disabled with a stated reason
   unless a matching phase 1 inspection with no errors exists. The form proposes a profile from
   the channel of the cue that uses the version (an asset used on several channels asks staff to
   choose) and shows what the profile will do (targets, outputs). A waiting, running or recorded
   job is reported instead of submitting again (the phase 1 pattern).
2. **Review preview.** The result panel shows: before and after loudness, true peak, loudness
   range, gain applied, size and bit rate per output, findings, and A/B players (source and each
   output) served by a staff-only route with `nosniff` and a sandboxed CSP. Loop and click
   checks are manual: the review notes whether a loop is seamless, because encoders add priming
   and padding. A required "I listened to every output I am promoting" confirmation is recorded.
3. **Promote.** One output at a time becomes a new unpublished `VALIDATED` version (Django, not the
   worker, reads the preview bytes and uses the normal upload path; see section 5), with lineage
   in its metadata. A duplicate of an existing version is refused as today. **Discard** removes
   previews.
4. **Publish.** Unchanged and explicit: set the cue's version, then publish a sound release
   (ADR-045). Children hear nothing until then. Rollback is the existing default-version and
   release rollback.

Nothing in this flow changes the engine or the loader; format negotiation (Opus with an MP3
alternate) is a separate decision (W4-7).

## 5. Audio requirements on the derived artifact design

The storage model is `proposals/ADR-PROPOSED-derived-artifacts.md` (not designed here). Audio
needs it to provide:

- A preview record per output linked to the source `AssetVersion`, immutable, with SHA-256, size,
  content type, codec, container, duration, sample rate, channels, bit rate, label and profile
  reference, the processor and FFmpeg build identity, and the measured-before and measured-after
  loudness numbers (small, structured).
- Staff-only serving with the media route hardening, byte-range support for audio players, and a
  checksum verified on read.
- Several outputs from one job (up to 3), promotable independently.
- Promotion that goes through the normal upload validation (`validation_media.validate_audio`) and
  records lineage (`derivedFrom`: source version, job, profile, tool build) without editing any
  immutable field of a published version.
- Expiry of unpromoted previews (proposed 30 days) and deletion with the source's cleanup rules.
- Regeneration: a new processor or profile version adds previews; old ones stay until they expire.

## 6. 008b acceptance criteria and dependencies

Acceptance criteria (008b is done only when all hold, each with a test unless stated):

1. The ADR is accepted and numbered; the derived-artifacts ADR is accepted; owner decisions A-1
   to A-9 are recorded.
2. `asset.transcode_audio` is in the closed catalog with the five profiles registered, a pure
   processor module (no process execution in `lai_processing`; the independence test still
   passes), and a runner outside it behind a fake in tests.
3. Every profile validates; loudness gain, retry and tolerance logic is unit tested without
   FFmpeg; the golden output facts for the synthetic fixtures are recorded from a real run.
4. The runner satisfies every row of section 3, each proven by a test with a fake executable or
   fixture: argv shape, empty environment, checksum mismatch refused, timeout kill, output cap,
   per-job directory cleanup, metadata absence in outputs (re-inspected), and the guard that only
   one module may run a process.
5. Django handler and Admin flow of section 4 with authorization tests (editor, publisher,
   anonymous, non-staff), the phase 1 gate, idempotent resubmission, mismatch handling as in
   phase 1, and escaped rendering of every file-derived value.
6. No version is created or published without the explicit staff actions; the source version and
   any published version are byte-identical afterwards (test).
7. The benchmark has been run on the arm64 target (an approved test environment) and the sizing
   and timing rows of the ADR are replaced with measured numbers; licence build record stored.
8. Documentation, `IMPLEMENTATION_STATUS.md`, and the jobs migration for the new kind (shared with
   other Wave 4 kinds if they are still pending) are updated.
9. No deployment occurs without owner approval; the worker zip and Django ship together
   (consumer first, WAVE4_HANDOFF section 3).

Dependencies: ADR acceptance (A-1 to A-9); the derived-artifacts ADR and its model and storage
grant (W4-4); the canonical Wave 4 jobs branch merged; an owner-approved dev deployment of the
function, layer, queue, DLQ and alarm (W4-8, LAI-LAMBDA-011 for live acceptance); a CI job that
builds the LGPL FFmpeg layer reproducibly (A-7). Blocked tasks: 008b implementation and
deployment; a game-side format negotiation for alternates (W4-7) is separate and is not required
to ship one Opus or MP3 version per asset.

## 7. Benchmark and tests

`scripts/processing/bench/audio_native_bench.py` (needs `LAI_FFMPEG_BIN`) runs every profile on
deterministic synthetic WAVs through the real runner and prints JSON (time, peak child RSS, size,
bit rate, loudness or peak error, true-peak margin). Unit tests need no FFmpeg; the real-binary
tests (`test_audio_ffmpeg_integration.py`, `test_audio_engine.py::test_real_ffmpeg_through_the_engine`)
skip unless `LAI_FFMPEG_BIN` is set.

## 8. Measurements (x86_64 workstation, NOT Lambda)

Host: Intel i7-12700K, 4 vCPU share, x86_64, FFmpeg 7.1.5 built in an Amazon Linux 2023 container
with nasm (x86 assembly on). Layer: **1,510,244 bytes zipped (1.44 MiB), 3.55 MB unzipped**
(`lai-ffmpeg-layer-x86_64.zip`, sha256 `72876c3c...`; arm64 size not measured). One
`ffmpeg -version` call: 59 ms. Job wall time covers every output of the profile (two outputs);
RSS is the largest FFmpeg child (`wait4` rusage). Accuracy: loudness error is output minus target
(LU), peak error is sample peak minus target (dB), margin is the true-peak ceiling minus measured
true peak (positive is under the ceiling).

| Case (input) | Output | Size | kbit/s | Job wall s | Realtime x | Peak RSS MB | Error | TP margin dB |
|---|---|---|---|---|---|---|---|---|
| voice 10 s mono 44.1k | Opus | 65,972 | 53 | 1.36 | 7.3 | 35 | +0.1 LU | 6.9 |
| voice 10 s mono 44.1k | MP3 | 80,456 | 64 | 1.36 | 7.3 | 35 | -0.4 LU | 7.4 |
| voice 60 s stereo 44.1k | Opus | 407,589 | 54 | 9.2 | 6.5 | 36 | 0.0 LU | 7.0 |
| music 60 s stereo | Opus / MP3 | 897,844 / 531,255 | 120 / 71 | 14.5 | 4.1 | 66 | +0.1 LU | 11.8 |
| music 110 s stereo | Opus / MP3 | 1,668,814 / 821,838 | 121 / 60 | 28.7 | 3.8 | 65 | +0.1 LU | 11.8 |
| ambient 60 s stereo 48k noise | Opus / MP3 | 345,763 / 503,014 | 46 / 67 | 29.9 | 2.0 | 87 | -0.6 / -0.5 LU | 11.3 / 12.4 |
| voice 900 s mono 8k (worst case) | Opus / MP3 | 8,800,055 / 7,200,599 | 78 / 64 | 102.4 | 8.8 | 87 | 0.0 / -0.4 LU | 7.0 / 7.4 |
| sfx 1 s mono noise | Opus / MP3 | 8,997 / 17,135 | 72 / 131 | 1.47 | 0.7 | 17 | -0.5 / -0.3 dB | 2.1 / 0.6 |
| ui 0.3 s mono sine | Opus / MP3 | 2,658 / 2,924 | 71 / 69 | 0.69 | 0.4 | 17 | +0.3 / -0.4 dB | 4.7 / 5.4 |

Notes: synthetic tones and noise stand in for real assets (the bit rates of tonal music are not
representative); the 900 s case is a worst-case duration with 8 kHz mono WAV (the 20 MiB cap bounds
other worst cases); the short effect cases needed two true-peak retries on noise (finding
`true_peak_retry`). Ambient and music took the longest per input second because the outputs are
stereo and each output is measured twice plus encoded. Pure-Python synthesis time is excluded.
Lambda timings will differ (arm64, vCPU share by memory size); size the function from an arm64
measurement (open decision O-3). Ogg Vorbis input decoding is compiled in but not exercised by a
fixture (no Vorbis encoder is built); Opus and MP3 outputs were decoded back as inputs.

## 9. Processing pipeline as implemented

1. Header inspection with the phase 1 inspector (format from bytes; PCM or float WAV, MP3, Ogg
   Vorbis or Opus; errors refuse the job; duration over the profile limit refuses).
2. Per output, the signal is resampled and downmixed explicitly (`aresample`, `pan` average for
   stereo to mono, `aformat`) so measurement and encode see the same signal. Never upmixed.
3. Pass 1: `loudnorm print_format=json` (integrated profiles, 3 s or longer) or `ebur128` with
   sample and true peak (peak profiles, short clips).
4. One linear gain: loudness target minus measured, or peak target minus sample peak. When the
   true-peak ceiling leaves less headroom than the gain needs, `alimiter` holds the ceiling
   (`true_peak_limited`). A source needing more than +20 dB, or silent, is refused (`silent_source`).
5. Encode (Opus `-application voip` for voice, `audio` otherwise, VBR; MP3 CBR or VBR), `-n`,
   `-fs` size cap, metadata and chapters dropped, bitexact flags, no ID3.
6. Decode and measure the output; overshoot over the true-peak ceiling (or, for peak profiles,
   0.5 dB over target) re-encodes with less gain, twice at most.
7. Re-inspect the output (format, codec, channels, sample rate for MP3, duration within
   0.15 s + 1 percent, or 0.06 s for loop profiles), then write artifacts (engine) and the report.

The Opus header stores a constant `encoder=Lavc libopus` comment and MP3 a `Lavf lame` info tag;
no source-derived text survives (tested with a hostile RIFF `LIST` chunk).

## 10. Sound Manager integration (phase 2, implemented)

Code: `lai/apps/audio/transcoding.py` (submission, results, resolver), `lai/apps/audio/admin.py`
(actions and pages), `lai/apps/audio/migrations/0006_transcode_permission.py`, tests in
`lai/apps/audio/tests/test_audio_transcoding.py` and `tests/lambda/test_audio_worker.py`.

- **Actions** (Audio files and Sound cues, staff Django Admin, permission
  `audio.transcode_audiofile`, granted by `ensure_sound_roles` to Sound editors and publishers;
  Sound editors also get read-only `assets.view_derivedartifact`): *Inspect audio* (existing
  `asset.process_audio`), *Transcode* (`options={"normalize": false}`: Opus and MP3, level kept,
  measured only) and *Normalise* (`normalize: true`: level set to the profile target). The profile is
  `audio-<channel>` v1, with the channel taken from the cue, or from the file's cues when exactly one
  channel uses it.
- **Submission** is `apps.assets.artifact_jobs.submit_derived_job` with
  `profile=("audio-<channel>", 1)`, `processor_version=AudioTranscodeProcessor.version` and the
  `AUDIO_TRANSCODE_LIMITS` ceilings (20 MiB in, 48 MiB out, 4 artifacts). It refuses first, with
  the message "This kind of background processing is switched off." (`WorkloadUnavailable`), when
  `LAI_AUDIO_TRANSCODING` is off or the queue is not configured, creating no row, outbox entry or
  message. The same work (version, file, profile, option, processor version) returns the existing job;
  a failed one may be resubmitted up to `LAI_ASSET_VALIDATION_MAX_ATTEMPTS`.
- **Results** are recorded by `apps.assets.artifact_results` (registered for the kind by A); the
  processor version resolver is registered by `AudioConfig.ready()`
  (`PROCESSOR_VERSION_RESOLVERS["asset.transcode_audio"]`), so an older processor's result is
  `processor_outdated`. The worker's `metadata.tool_versions` and `metadata.artifact_facts` (duration,
  bit rate, rate, channels, loudness, peaks per output) become each artifact's safe metadata.
- **Display**: job status and outcome, and per output the format, duration, bit rate, size, loudness
  and true peak before and after, the gain, findings, and links to A's review page and streamed
  preview. Every value is escaped.
- **Never automatic**: no version, cue, release or published file changes; the only way to the game
  is `promote_artifact` (permission `assets.promote_derivedartifact`, Asset publishers), a new
  unpublished version, then the normal publish and sound release.
- **Worker**: `lambda/audio_worker` uses `jobs_worker.aws.Runtime.artifact_storage` (create-only,
  `IfNoneMatch="*"`, computed-checksum idempotency) as the engine's storage; the earlier stub was
  removed.
