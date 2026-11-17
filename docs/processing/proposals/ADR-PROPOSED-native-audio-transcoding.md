# Proposed: native audio transcoding and loudness normalisation (LAI-LAMBDA-008 phase 2)

**Status: Proposed — not accepted; no ADR number assigned.** Written 2026-11-17 with phase 1
(`../AUDIO_INSPECTION.md`). Nothing here is implemented, approved or deployed. When the owner
accepts it, it is numbered from the registry in `docs/DECISIONS.md` and moved there. It answers
ADR-064 decision 9 ("a container-image worker needs its own ADR naming the workload") and the
Wave 4 owner decisions W4-1, W4-4 and W4-5 (`../WAVE4_HANDOFF.md` section 6) for audio.

## Context

- Phase 1 (`asset.process_audio`, profile `audio-inspect` v1) reads headers only, in the standard
  library, inside the shared jobs worker zip. It cannot decode, measure loudness or transcode.
- Staff upload MP3, PCM or float WAV, and Ogg Vorbis or Opus up to 20 MiB and 15 minutes
  (`lai/apps/assets/validation_media.py`). Files arrive at whatever level and format the source
  tool produced; a child hears them through the Sound Manager mixer (per-channel volumes, ducking).
- Measuring loudness (ITU-R BS.1770 / EBU R128) and encoding Opus or MP3 need a decoder and
  encoders: in practice FFmpeg with libopus and libmp3lame. FFmpeg is native code.
- ADR-064: zip is the default packaging; dev has no ECR; containers only for workloads with
  significant native dependencies, each by its own decision. `tests/processing/
  test_processing_runtime_independence.py` forbids `subprocess`, `ctypes` and dynamic loading in
  `processing/lai_processing`, so FFmpeg can never be called from the shared library.
- The worker's contract storage port is read-only today; no kind writes artifacts (W4-4).
- Only staff-authored assets are processed. Never child speech, recordings or photos; Polly
  speech (`speech.synthesize`) is out of scope.

## Proposed decision

1. **A separate native audio worker**, not the shared media worker: one arm64 Lambda function
   `lai-<env>-jobs-audio` packaged as a **container image** (FFmpeg, ffprobe and a small Python
   runner), on its own work queue `lai-<env>-jobs-audio` with a DLQ after 3 receives, sending
   schema-1 results to the existing `lai-<env>-job-results` queue, consumed by the existing
   `jobs_consume_results`. One job model, one consumer, one results queue (ADR-064 decision 1);
   the new queue is an additional work queue of the same family, needed because one SQS queue
   maps to one function and the existing media worker stays a zip.
2. **Job type** `asset.transcode_audio` (new, owner task LAI-LAMBDA-008) with profile
   `audio-web-v1`; `asset.process_audio` stays the phase 1 inspection. Phase 1 inspection (and an
   ffprobe decode check) runs first; a file with errors is not transcoded.
3. **Outputs** (profile `audio-web-v1`):

   | Output | Codec and settings | Why |
   |---|---|---|
   | Primary | Ogg Opus, 48 kHz, VBR: 96 kbit/s stereo music and ambience, 64 kbit/s voice, 48 to 64 kbit/s effects | Best quality per byte; native in Chrome, Edge, Firefox; Opus is the browser-native low-latency codec |
   | Fallback | MP3 (LAME), 44.1 kHz, VBR quality 4 (about 165 kbit/s) or CBR 128 kbit/s for effects | Universal decoder support; covers Safari versions without Ogg Opus support (verify the current Safari matrix before choosing whether the fallback is required) |

   The game keeps choosing by `canPlayType`; the loader change is a separate task (ADR-020 rules:
   the engine only plays what Django publishes).
4. **Loudness**, two-pass `loudnorm` in linear mode (measure, then apply a single gain without
   dynamic compression where the target allows), per Sound Manager channel:

   | Channel | Target | True peak | Justification |
   |---|---|---|---|
   | Music, ambience | -18 LUFS integrated | -1 dBTP | Sits below voice so narration stays intelligible; the mixer adds channel volumes on top |
   | Voice (staff narration assets) | -16 LUFS integrated | -1 dBTP | About -16 LUFS is the common target for speech on mobile and web streaming (AES TD1004 recommends -16 to -20 LUFS for streaming; podcast platforms use -16), so phones at moderate volume are clear without boosting |
   | Effects, UI | No integrated target; peak normalise to -3 dBTP and flag files whose short-term loudness exceeds -14 LUFS | Integrated loudness is not meaningful for clips under about 3 s; the limit protects children from sudden loud effects |

   -1 dBTP measured **after** encoding (lossy encoders overshoot inter-sample peaks); if the encoded
   file exceeds it, re-encode with 0.5 dB less gain (bounded to 2 retries). Reduced-intensity mode
   (`ChildAudioSettings.reduced_intensity`) stays a playback setting, not a second encode.
5. **Derived files are new, unpublished Asset Library versions** (W4-4): the worker writes each
   output create-only under `processing/artifacts/<namespace>/<job_id>/<attempt_id>/` (the
   ADR-061 artifact prefix; the worker role may write only there). Django's handler verifies each
   artifact (checksum, size, ffprobe facts from the result, phase 1 inspection of the bytes) and
   copies it into a new `AssetVersion` of the same asset with status `VALIDATED`, a new key under
   `assets/audio/`, and provenance in its metadata (source version uuid, job id, processor and
   profile, measured loudness before and after). The source version is never changed.
6. **Staff review and publication.** The Sound Manager admin shows source and derived versions
   side by side (players, loudness numbers, findings). Publishing a derived version is the
   existing Asset Library publish action; making it the cue's version is the existing cue edit;
   children hear it only after a sound release is published (ADR-045). Nothing is automatic.
7. **Rollback.** Published versions are immutable; rolling back is choosing the earlier version
   as default (existing action) and publishing a release. Derived versions that were never
   published can be deleted with their objects; artifacts under `processing/artifacts/` expire by
   a lifecycle rule (proposed 30 days).
8. **Security restrictions.** Inputs: published or validated staff audio versions only, checksum
   verified before decoding, phase 1 inspection must pass. FFmpeg runs as an argv list (never a
   shell) with `-nostdin -hide_banner -protocol_whitelist file`, explicit input format
   (`-f wav|mp3|ogg` from the detected format), explicit codecs, `-t` capped at 900 s, a wall-clock
   timeout below the function timeout, output only into a per-job directory in `/tmp`, and a byte
   cap on outputs. The function has no database access; network: outside a VPC Lambda has
   internet egress, so the protocol whitelist is the control (or place the function in a VPC
   with no NAT and an S3 gateway endpoint, owner choice). IAM: read the asset bucket `assets/`,
   write only `processing/artifacts/`, send results, receive its own queue. The image is built
   off-host in GitHub Actions from pinned sources, scanned, and referenced by digest.

## Packaging constraints and comparison

| Option | Limits | Fit |
|---|---|---|
| Zip in the shared worker | 50 MB zipped upload, 250 MB unzipped including layers | FFmpeg cannot be called from `lai_processing` (no subprocess by rule); would also put native code on the queue every media kind uses. Rejected |
| Zip plus a Lambda layer with static FFmpeg | Same 250 MB unzipped total; a static arm64 FFmpeg with libopus and libmp3lame is roughly 30 to 80 MB | Fits technically and needs no ECR, but layers are versioned out of band, licence and source tracking is harder, and it still needs a separate function (subprocess runner outside `lai_processing`). Viable fallback if the owner refuses ECR |
| Container image | Up to 10 GB uncompressed; pulled and cached by Lambda | Python base plus FFmpeg is expected under 1 GB. Reproducible build, digest pinning, scanning. **Recommended** |

## Runtime sizing (estimates; to be measured by a spike before acceptance)

| Item | Estimate | Basis |
|---|---|---|
| Image size | 400 to 900 MB uncompressed | AWS Python base image plus a minimal FFmpeg build |
| Cold start | 1 to 3 s extra for a new image, less once cached | Typical for images of this size; measure |
| Memory | 2,048 MB (about 1.15 vCPU on arm64; CPU scales with memory) | Decoding a 20 MiB file and encoding two outputs fits comfortably; more memory mainly buys CPU |
| Ephemeral storage | 1,024 MB | Input (20 MiB), decoded PCM for loudness (15 min stereo 48 kHz float is about 690 MB worst case if written to disk; stream instead), outputs |
| Time per job | 5 to 20 s for a 3 minute file; up to about 120 s for 15 minutes | Opus and LAME encode far faster than real time on one core; two-pass loudness doubles the decode |
| Timeout | 300 s function timeout, 240 s engine budget | Well inside Lambda's 900 s maximum |

## Cost estimate (verify current pricing)

Assumptions: Lambda arm64 duration price **$0.0000133334 per GB-second** and **$0.20 per million
requests** (AWS Lambda public pricing for US East (N. Virginia), arm64, first pricing tier, as last
known before 2026-11; **verify current pricing for us-west-1 before relying on it**); ephemeral
storage above 512 MB about $0.0000000309 per GB-second (verify); ECR storage about $0.10 per GB
per month (verify).

| Scenario | GB-seconds | Lambda cost |
|---|---|---|
| One 3 minute file, 2 GB, 15 s | 30 | about $0.0004 |
| One 15 minute file, 2 GB, 120 s | 240 | about $0.0032 |
| 1,000 typical files a month | 30,000 | about $0.40, plus about $0.0002 for requests |
| ECR, one 1 GB image kept with two older digests | 3 GB | about $0.30 a month |

Phase 1 inspection, for comparison, runs in the existing media worker in well under a second per
file. Audio processing is not a meaningful cost; the operational cost is the image pipeline.

## Licensing (LGPL-compatible build)

- Build FFmpeg **without** `--enable-gpl` and `--enable-nonfree`; the result is LGPL-2.1-or-later.
  Enable only: decoders for PCM, MP3, Vorbis, Opus, FLAC (input inspection); encoders libopus
  (BSD) and libmp3lame (LGPL); muxers ogg, mp3, wav; filters `loudnorm`, `aresample`,
  `alimiter`; protocols `file` only. Do not enable libx264, libfdk-aac or any GPL or non-free
  component.
- Ship the exact FFmpeg, libopus and LAME versions, configure flags, build script and the
  corresponding source (or a written offer) with the image, and record them in a licence notice.
  Prefer dynamic linking of the LGPL libraries so they can be replaced; if static, publish the
  object files or build recipe needed to relink (LGPL section 6).
- Record each tool and licence in the ADR when accepted (`WAVE4_HANDOFF.md` security baseline).

## Alternatives considered

| Alternative | Why not proposed |
|---|---|
| Pure-Python encoders | No maintained pure-Python Opus or MP3 encoder of acceptable speed and quality |
| Transcoding in the browser at upload | Moves trust to the client; the server must still verify; staff tools vary |
| Running FFmpeg on the Django EC2 instance | Heavy work on the small instance that also serves requests and stops overnight (ADR-061 rejects this as the default) |
| AWS Elemental MediaConvert | Built for video; costlier per minute and more configuration for short game audio |
| Fargate tasks | Slower start and more infrastructure for jobs well under 15 minutes (ADR-061 keeps Fargate for over-15-minute work) |
| Normalising every file to one target | Effects and music need different treatment; one target makes effects too loud |

## Recommendations

1. Accept phase 1 as is (header inspection in the zip, staff-triggered, results on the job).
2. Spike before accepting this ADR: build the LGPL image, measure size, cold start and time on
   20 representative assets, and confirm Safari's Ogg Opus support to decide on the MP3 fallback.
3. Accept a container-image worker on its own queue with the restrictions above, and derived files
   as new unpublished Asset Library versions with provenance.
4. Start with channel-based loudness targets (-16 LUFS voice, -18 LUFS music and ambience, effects
   peak-normalised to -3 dBTP with a short-term loudness flag), -1 dBTP true peak after encoding.

## Owner decisions needed

| # | Decision |
|---|---|
| A-1 | Container image worker for audio (ECR repository, image pipeline in GitHub Actions, scanning), or the zip-plus-layer fallback |
| A-2 | A fourth work queue `lai-<env>-jobs-audio` (with DLQ and alarm) for the native function |
| A-3 | Output formats: Ogg Opus primary; whether the MP3 fallback is required |
| A-4 | Loudness targets per channel and the true-peak ceiling |
| A-5 | Derived files as new unpublished `AssetVersion` rows (W4-4), the artifact write permission for the worker, and the artifact lifecycle rule |
| A-6 | Network isolation: protocol whitelist only, or a VPC without NAT |
| A-7 | Licence handling: the LGPL build, source publication and the licence notice |
| A-8 | Every deployment and sizing change (W4-8) |
