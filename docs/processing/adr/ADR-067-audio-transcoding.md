# ADR-067: Native audio transcoding with LGPL FFmpeg

Status: **Accepted (owner, 2026-11-18)** for the items under "Decision". Items under "Open
decisions" are not accepted. Task: LAI-LAMBDA-008b. Row in `docs/DECISIONS.md` is added by the
principal at integration. Supersedes the proposal `ADR-PROPOSED-native-audio-transcoding.md` on
the design branch `feature/lambda-audio-transcoding-design` (kept as history).

## Context

Phase 1 (`asset.process_audio`) inspects audio headers in the standard library. Loudness
measurement and Opus or MP3 encoding need a decoder, filters and encoders (FFmpeg with libopus and
libmp3lame), which is native code. ADR-064 requires a workload-specific ADR before any native tool;
`lai_processing` must never run a process (guarded by tests). Only staff-authored Sound Manager
audio is processed, never child recordings. ADR-066 (derived artifacts) defines where outputs go.

## Decision (accepted)

1. **LGPL FFmpeg only.** FFmpeg 7.1.5 built without `--enable-gpl`, `--enable-nonfree` or
   `--enable-version3`, with libopus 1.6.1 (BSD-3) and LAME 3.100 (LGPL), all shared libraries
   shipped in the layer, pinned sources with SHA-256, no patches, licence notices and a CycloneDX
   SBOM in the layer (`native/ffmpeg/`).
2. **Opus primary, MP3 alternative.** Ogg Opus 48 kHz is the primary output of every profile; MP3
   (LAME, 44.1 kHz) is the optional alternative. No other output formats (no WAV output).
3. **Packaging: a zip function plus one FFmpeg layer** on arm64 (`lambda/audio_worker/`,
   layer at `/opt`, binary `/opt/bin/ffmpeg`), no container image, ECR or Fargate. A **separate
   function with its own work queue `audio`** (`LAI_JOBS_AUDIO_QUEUE_URL`), routed per
   `COMPLETION_INTEGRATION.md` section 3; kind `asset.transcode_audio`, feature control
   `LAI_AUDIO_TRANSCODING` (default off). Results return on the existing results queue to the
   existing `jobs_consume_results`; there is no second job system, results queue or consumer.
4. **Artifacts through ADR-066**: one `audio.transcoded` artifact per output (`audio/ogg`,
   `audio/mpeg`, promotable) and one `audio.report` (`application/json`, not promotable),
   written create-only under `processing/artifacts/<env>/<job>/<attempt>/`. Nothing is published
   automatically; staff listen and promote through the Sound Manager (phase 2, Django side).
5. **Native execution confined to `lai_native`**: one shared tool runner
   (`lai_native/runtime`) is the only module that starts a process, with fixed trusted executable
   path, argv lists, `shell=False`, scrubbed environment, private 0700 workspace, wall-clock
   timeout and Lambda deadline, RLIMIT_CPU/AS/FSIZE/NOFILE, bounded stdout/stderr, workspace
   size watch, optional binary SHA-256 pin, cooperative cancellation and code-only errors. FFmpeg
   input is restricted (`-protocol_whitelist file`, explicit `-f`, first audio stream only, no
   metadata) and the build has only the `file` and `pipe` protocols. Guard tests enforce the
   import allowlist.
6. **Profiles** (`lai_native/audio/profiles.py`, ids `audio-sfx|ui|ambient|music|voice`, version 1;
   a changed target is a new version, never an edit): dialogue (voice channel, authored only)
   -16 LUFS, music -18, ambient -20 (loop), integrated with -1 dBTP; effects peak -3 dBFS and
   interface sounds peak -6 dBFS, true peak held at or below -1 dBTP. Mono dialogue stays mono, no
   upmixing. Clips under 3 s are peak normalised (integrated loudness is unreliable). The values
   are the design targets and stay adjustable.
7. **Measure, then one linear gain** (BS.1770 via `loudnorm` JSON for integrated profiles, `ebur128`
   for peak profiles and the after-measure), `alimiter` only when true-peak headroom is short,
   re-measure each output, retry with less gain (twice) on overshoot, findings for anything
   still outside tolerance. Facts only; correctness of "good enough" is staff review.

## Consequences

- Layer is about 1.4 MiB zipped (x86_64 measured); the function zip is a few hundred KiB.
- Two bytes-identical encodes of the same input are produced (bitexact flags), so redelivery is
  harmless; tool identity (version, binary SHA-256) is in every result.
- FFmpeg 7.1.x security fixes arrive by backport only; a version bump is a new pinned build and
  re-run of the integration tests and benchmark.
- A sound that cannot be decoded is a permanent failure, a timeout is retryable, a missing or
  altered binary is manual.

## Evidence (all x86_64 workstation, not Lambda; see AUDIO_TRANSCODING.md section 8)

x86_64 layer build and integration tests pass; arm64 was not built or run (no qemu on the
workstation); no Lambda measurement exists.

## Open decisions (not accepted)

| # | Decision | Notes |
|---|---|---|
| O-1 | Build and publish the arm64 layer in CI (Workstream G wiring) and publish to Lambda | Needs owner approval; nothing deployed |
| O-2 | FFmpeg 7.1.x versus a newer major (8.x, 9.x) | 7.1.5 chosen as the current 7.x; re-check CVEs first |
| O-3 | Function memory, timeout, reserved concurrency, queue visibility | Derive from arm64 Lambda measurements, not yet taken |
| O-4 | Final loudness and bit rate values | Design targets; staff listening may change them (new profile version) |
| O-5 | Game-side format negotiation (Opus with MP3 alternate per asset) | Today one version per asset; separate decision (W4-7) |
| O-6 | VPC without NAT for the audio function | Stronger network control; cost and ops trade-off |
| O-7 | Seamless-loop guarantee for ambient (encoder padding, Opus pre-skip) | Reported as findings only; staff reviews loops |
| O-8 | Short-term loudness (3 s) flags | Not measured in v1 |
