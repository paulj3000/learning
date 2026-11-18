# Proposed: native audio transcoding and loudness normalisation (LAI-LAMBDA-008 phase 2)

**Status: Proposed. Not accepted; no ADR number assigned.** Written 2026-11-17 with phase 1
(`../AUDIO_INSPECTION.md`); revised the same day as LAI-LAMBDA-008b (this revision recommends a zip
plus layer runtime first and adds profiles, security and acceptance criteria; the operational
design is in `../AUDIO_TRANSCODING.md`). Nothing here is implemented, approved or deployed. When the owner
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

1. **A separate native audio worker, not the shared media worker**: one arm64 Lambda function
   `lai-<env>-jobs-audio` on its own work queue `lai-<env>-jobs-audio` with a DLQ after 3
   receives, sending schema-1 results to the existing `lai-<env>-job-results` queue, consumed by
   the existing `jobs_consume_results`. One job model, one consumer, one results queue (ADR-064
   decision 1); the new queue is an additional work queue of the same family, needed because one
   SQS queue maps to one function and the existing media worker stays a zip with no native code.
   **Packaging: a zip function with one FFmpeg Lambda layer first** (no ECR, consistent with
   ADR-064 decision 3 for dev); a container image only if the spike shows the layer cannot meet
   the size, licence or reproducibility needs (see "Runtime comparison"). FFmpeg is invoked only
   by a small runner module in the audio function's own package (proposed `lambda/audio_worker/`),
   never from `lai_processing`; a new guard test must restrict process execution to that one
   module.
2. **Job type** `asset.transcode_audio` (proposed name; not in the closed catalog) with
   per-category profiles `audio-sfx-v1`, `audio-ui-v1`, `audio-ambient-v1`, `audio-music-v1` and
   `audio-voice-v1` (`../AUDIO_TRANSCODING.md` section 2, model in
   `processing/lai_processing/contracts/audio_profiles.py`); `asset.process_audio` stays the phase 1
   inspection. Phase 1 inspection runs first
   and must be recorded for the exact version with no errors; a file with errors is not
   transcoded. No `ffprobe` binary is shipped: phase 1 plus FFmpeg's own decode errors suffice.
3. **Outputs and loudness are per category profiles**, not one `audio-web-v1`. Primary output
   Ogg Opus at 48 kHz (voice 48 kbit/s mono, effects and ambience about 64 kbit/s, music about
   96 kbit/s); optional MP3 (LAME) fallback at 44.1 kHz; uncompressed WAV only for interface
   clips of 10 s or less. Loudness: integrated targets of -16 LUFS (voice), -18 LUFS (music) and
   -20 LUFS (ambient) with -1 dBTP true peak, peak normalisation for effects (-3 dBFS) and
   interface sounds (-6 dBFS), measured before and after encoding. Settings, tolerances and the
   justification for every number are in `../AUDIO_TRANSCODING.md` section 2. They are proposals
   for owner decision A-4, not measured results.
4. **One file per version.** Today a cue resolves one `AssetVersion` (`default_version`), so an
   Opus primary and an MP3 fallback cannot both be served from one asset: format negotiation
   would need a loader and resolver change (ADR-020: the engine plays what Django publishes;
   W4-7). Until the owner decides, a transcode request creates every configured output as a
   staff-only preview, and staff promote **one** of them to a new version.
5. **Derived files** (W4-4). The storage model is not designed here: see
   `ADR-PROPOSED-derived-artifacts.md` (written concurrently; its candidate Option C keeps
   staff-only derived preview records linked to the source `AssetVersion`, and a reviewed
   deliverable is promoted into a new unpublished `AssetVersion`, then published by the existing
   explicit staff action). This ADR only needs from it the audio requirements in
   `../AUDIO_TRANSCODING.md` section 5. In any model the worker writes each
   output create-only under `processing/artifacts/<namespace>/<job_id>/<attempt_id>/` (the
   ADR-061 artifact prefix; the worker role may write only there, which needs an owner-approved
   grant). Django's handler verifies each artifact (checksum, size, the worker's measured facts,
   phase 1 inspection of the bytes); a promoted deliverable becomes a new `VALIDATED`,
   unpublished version with provenance (source version uuid, job id, processor, profile,
   loudness before and after, reviewing staff user). The source version is never changed.
6. **Staff review and publication.** The Sound Manager admin shows source and derived versions
   side by side (players, loudness numbers, findings). Publishing a derived version is the
   existing Asset Library publish action; making it the cue's version is the existing cue edit;
   children hear it only after a sound release is published (ADR-045). Nothing is automatic.
7. **Rollback.** Published versions are immutable; rolling back is choosing the earlier version
   as default (existing action) and publishing a release. Derived versions that were never
   published can be deleted with their objects; artifacts under `processing/artifacts/` expire by
   a lifecycle rule (proposed 30 days).
8. **Security restrictions** (full design: `../AUDIO_TRANSCODING.md` section 3). Staff-authored
   assets only, never child audio; phase 1 inspection as a pre-gate; format sniffed from bytes;
   the FFmpeg binary pinned by SHA-256 and verified before use; argv list, no shell; empty child
   environment (no AWS credentials); `-protocol_whitelist file`; wall-clock, memory, output-size
   and duration bounds; per-job directory in `/tmp`; metadata stripped; outputs re-inspected
   before they are offered; nothing publishes without explicit staff action.

## Runtime comparison

Lambda limits used below (AWS Lambda documentation; verify before relying on them): zip package
50 MB zipped for a direct upload and **250 MB unzipped including layers** (up to five layers);
container image up to **10 GB**; timeout up to **900 s**; memory 128 MB to **10,240 MB** (CPU
scales with memory, one vCPU at about 1,769 MB); ephemeral `/tmp` 512 MB to **10,240 MB**.

| Option | Fit | Cold start | Licence and provenance | Rollback | Verdict |
|---|---|---|---|---|---|
| **A. Zip function plus one FFmpeg layer** (static arm64 build, minimal configure) | Needs no ECR (ADR-064: no ECR in dev). A minimal build with only WAV/MP3/Ogg demuxers, PCM/MP3/Vorbis/Opus decoders, libopus and libmp3lame encoders and the filters used should be far below 250 MB (expected tens of MB; **not measured**, the spike measures it). Process execution is confined to one runner module in the audio function | Layer is unpacked into `/opt` at init: expected small; **not measured**. Python zip init as for the media worker | Must be a build we make: widely used prebuilt static ARM64 FFmpeg binaries are GPL builds (they enable `--enable-gpl` for x264 and similar), which this project must not ship. An LGPL build with libmp3lame and libopus is possible (below) and is reproducible in GitHub Actions from pinned sources, published to S3 with a checksum | Layer versions and function versions are immutable; an alias or the function's layer list points back at the prior layer version | **Recommended first**, subject to the spike |
| B. Container-image Lambda | 10 GB image, easy to add Python libraries; reproducible by digest; scanning in ECR | Image layers are pulled lazily and cached; first invocation after a deploy is slower than a small zip; **not measured** | Same build, plus base-image licences | Previous image digest | Fallback if the layer outgrows 250 MB, needs shared libraries that a static build cannot carry, or the owner prefers image scanning. **Needs ECR, which ADR-064 says dev does not have**, so it needs its own owner decision |
| C. Fargate task | No size or 15 min limit | Tens of seconds to start; more infrastructure | As B | Task definition revision | Not proposed: jobs are far below 15 minutes (ADR-061 reserves Fargate for longer work) |
| D. Django EC2 instance | None | None | None | None | Rejected: heavy work on the small shared instance that also stops overnight (ADR-061) |
| E. AWS Elemental MediaConvert | Managed | Job startup latency | AWS-managed | n/a | Not proposed: designed for video; per-minute pricing and configuration for short game audio |
| F. Pure Python | Fits the zip | None | None | n/a | Not possible at acceptable quality: no maintained pure-Python Opus or LAME encoder, and decoding for loudness measurement is the larger problem |

## Runtime sizing (estimates; the spike replaces them with measurements)

| Item | Estimate | Basis |
|---|---|---|
| Layer size | Tens of MB unzipped | Minimal static build; unmeasured |
| Memory | 2,048 MB | Roughly 1.15 vCPU on arm64 (CPU scales with memory); decoding a 20 MiB file and encoding two outputs is a streaming job with working memory far below this; more memory only buys CPU. A local run of the benchmark (`scripts/processing/bench/audio_transcode_bench.py`) gives the working-set figure |
| Ephemeral storage | 1,024 MB | Source copy (20 MiB), outputs (each at most 20 MiB), nothing else: decoded PCM is streamed through filters, never written (15 min stereo 48 kHz float would be about 690 MB) |
| Time per job | A few seconds for a 3 minute file; tens of seconds for 15 minutes | Opus and LAME encode much faster than real time on one core; two-pass loudness decodes twice. **No measurement exists.** The benchmark exists to replace this row |
| Timeout | 300 s function timeout, 240 s engine budget | Inside Lambda's 900 s maximum; the runner kills FFmpeg at 240 s |

## Cost estimate (verify current pricing)

Assumptions: Lambda arm64 duration price **$0.0000133334 per GB-second** and **$0.20 per million
requests** (AWS Lambda public pricing for US East (N. Virginia), arm64, first tier, as last known
before 2026-11; **verify current pricing for us-west-1 before relying on it**); ephemeral storage
above 512 MB about $0.0000000309 per GB-second (verify); S3 storage of a layer zip and ECR storage
(about $0.10 per GB-month, verify, option B only) are negligible at these sizes. Durations in the
scenarios are **assumptions, not measurements**.

| Scenario | GB-seconds | Lambda cost |
|---|---|---|
| One 3 minute file, 2 GB, 15 s (assumed) | 30 | about $0.0004 |
| One 15 minute file, 2 GB, 120 s (assumed) | 240 | about $0.0032 |
| 1,000 typical files a month, 15 s each (assumed) | 30,000 | about $0.40, plus about $0.0002 for requests |
| Option B only: one 1 GB image and two older digests in ECR | 3 GB stored | about $0.30 a month |

Audio processing is not a meaningful Lambda cost at staff upload volumes; the operational cost
is building, scanning and licensing the FFmpeg artifact, and staff review time.

## Licensing (LGPL-compatible build)

- Build FFmpeg **without** `--enable-gpl`, `--enable-version3` unless needed, and
  `--enable-nonfree`; the result is LGPL-2.1-or-later. Enable only: demuxers wav, mp3, ogg;
  decoders PCM, MP3, Vorbis, Opus; encoders **libopus** (BSD-3-Clause), **libmp3lame** (LGPL-2.0+,
  allowed in an LGPL FFmpeg build) and `pcm_s16le`; muxers ogg, mp3, wav, null; filters
  `loudnorm`, `ebur128`, `volumedetect`, `volume`, `aresample`, `alimiter`; protocol `file` only.
  **libvorbis** (BSD-3-Clause) is not needed: Vorbis input is decoded by FFmpeg's native decoder,
  and the proposal does not encode Vorbis. Add it only if the owner wants a Vorbis output.
- Never enable libx264, libx265, libfdk-aac, `libtwolame`, `rubberband` or any GPL or non-free
  component. The pinned binary's `-buildconf` output is stored with the build record and checked
  by the spike (no `--enable-gpl`).
- Static linking of LGPL libraries needs the means to relink (LGPL section 6): publish the exact
  source versions, configure flags and build script with the layer (a written offer is not enough
  for a binary we distribute to ourselves only; the owner decides whether the artifact is ever
  distributed outside the account). Record each tool and licence in the ADR when accepted
  (`../WAVE4_HANDOFF.md` security baseline), plus a notice file in the repository.
- MP3 patents expired in 2017; no licence fee applies to encoding with LAME (not legal advice).

## Rollback

A transcode never changes a published version. Rolling back the capability: stop submitting
(remove the Admin action or revoke the permission), then set the queue's function mapping off.
Rolling back the binary: point the function at the previous layer version (option A) or image
digest (option B). Rolling back content: choose the earlier `AssetVersion` as default and publish
a sound release (ADR-045); unpublished derived versions are deleted with their objects; artifacts
under `processing/artifacts/` expire by lifecycle rule (proposed 30 days).

## Recommendations

1. Accept phase 1 as is (header inspection in the zip, staff-triggered, results on the job).
2. Run a local spike first (this branch adds the benchmark; it needs only a locally installed
   FFmpeg), then the LGPL layer build in CI, measuring layer size, cold start and time on 20
   representative assets on arm64, and verify current Safari support for Ogg Opus to decide on the
   MP3 fallback. No deployment is needed for the local part.
3. Accept option A (zip plus layer) on its own queue with the restrictions above; keep option B as
   the fallback behind its own owner decision.
4. Start with the per-category targets in `../AUDIO_TRANSCODING.md`, tuned by staff listening.
5. Accept the derived-artifact model through `ADR-PROPOSED-derived-artifacts.md`; 008b waits on it.

## Owner decisions needed

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| A-1 | Runtime: A zip plus FFmpeg layer, or B container image (needs ECR) | A, with B as fallback | Everything beyond the benchmark |
| A-2 | A work queue `lai-<env>-jobs-audio` (DLQ and alarm) | Yes | Deployment |
| A-3 | Output formats and whether an MP3 fallback exists (see decision 4: one file per version) | Opus primary, MP3 alternate promotable by staff; format negotiation separate (W4-7) | Profiles freeze |
| A-4 | Loudness targets per channel and the true-peak ceiling | The table in `../AUDIO_TRANSCODING.md` | Profiles freeze |
| A-5 | Derived files model, worker artifact write grant, lifecycle rule | Per the derived-artifacts ADR | 008b implementation |
| A-6 | Network isolation: protocol whitelist plus empty environment, or a VPC without NAT | Whitelist and empty environment first | Deployment |
| A-7 | Licence handling: LGPL build, source publication, notice file | Yes | The layer build |
| A-8 | Every deployment and sizing change (W4-8) | Owner approval each time | All live use |
| A-9 | Whether staff may override the target LUFS per request within bounds | No: new profile versions instead | Admin form |
