# GLB optimization benchmark (LAI-LAMBDA-010): local harness

Local measurement scaffolding for the LAI-LAMBDA-010 feasibility study
(`docs/processing/feasibility/LAI-LAMBDA-010-glb-optimization.md`). It is not product code: it
is not imported by `processing/lai_processing`, the Lambda worker zip, Django or React, and it
adds no dependency to `requirements*.txt`, `pyproject.toml` or `package.json`.

| Script                  | What it does                                                                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `glb_baseline.py`       | Runs the existing GLB validator (`asset.glb_validator`, `glb-default` defaults) over repository GLBs and prints metadata, a byte breakdown by role, file size, and gzip (stdlib) and brotli (only if the module is importable) sizes. Standard library only |
| `optimization_bench.py` | Runs locally installed optimization tools on copies of GLBs in a temporary directory and records output size, gzip size, wall time, child peak RSS and the GLB validator's verdict on each output                                                           |

## Rules

- **Never in CI.** `optimization_bench.py` exits with status 3 when `CI`, `GITHUB_ACTIONS` or
  `CODEBUILD_BUILD_ID` is set. Do not add it to a workflow, a Makefile target used by CI, or a
  pytest collection path.
- **Never downloads.** Tools are found with `shutil.which` only. The harness never calls `npx`,
  `pip`, `npm`, a package manager or a URL. A tool that is not on `PATH` is reported as
  `skipped: tool not installed` and nothing else happens.
- **Copies only.** Each run copies the input into a fresh `tempfile.TemporaryDirectory`, runs
  the tool there as an argv list (no shell) with a minimal environment and a timeout (default
  300 s), and deletes the directory. Originals and the repository are never written.
- **No asset binaries are committed.** Inputs are files already in the repository or files on
  the developer's machine. Outputs never leave the temporary directory; only the numbers are
  printed.
- **No claims without numbers.** A saving is reported only from a row with `status=ok`.

## Installing tools (developer machine only, never the repository)

Installing a tool is the developer's own action, outside this repository and outside CI. The
harness does not care how the tool got on `PATH`. Record the exact tool version with every
result (`gltfpack -v`, `toktx --version`, `basisu -version`, `gltf-transform --version`).

| Tool                                                                         | Variants in the harness                                                                                                            | Emits                                                                                                                                      | Loadable today?                                                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `gltfpack` (meshoptimizer, MIT)                                              | `gltfpack-default`, `-noq`, `-meshopt` (`-c`), `-meshopt-cc` (`-cc`), `-simplify-50` (`-si 0.5`), `-ktx2` (`-tc`), `-meshopt-ktx2` | `KHR_mesh_quantization` and `KHR_texture_transform` by default; `EXT_meshopt_compression` with `-c`/`-cc`; `KHR_texture_basisu` with `-tc` | Only the variants without a compression extension. The validators refuse the others (`needs_decoder`) |
| `gltf-transform` (glTF-Transform CLI, MIT; global install only, never `npx`) | `gltf-transform-draco`, `gltf-transform-meshopt`                                                                                   | `KHR_draco_mesh_compression`, `EXT_meshopt_compression`                                                                                    | No (`needs_decoder`)                                                                                  |
| `toktx` (KTX-Software, Apache-2.0)                                           | `toktx-etc1s`, `toktx-uastc` (image inputs, `--image`)                                                                             | `.ktx2` files                                                                                                                              | Not applicable: images, not GLBs                                                                      |
| `basisu` (Basis Universal, Apache-2.0)                                       | `basisu-ktx2` (image inputs, `--image`)                                                                                            | `.ktx2` files                                                                                                                              | Not applicable                                                                                        |

The command-line flags in the variant table come from the tools' documentation and have not been
run here (no tool was installed when the harness was written, 2026-11-17). Check each flag
against the installed version before trusting a result; KTX-Software 4.4 also ships the newer
`ktx create` command, which may replace `toktx` in a later release.

Image extraction, resizing and re-encoding belong to LAI-LAMBDA-013 ("013 owns image resize").
The texture variants only time the compressors on images that already exist as files.

## Running

```sh
# Which tools are installed (nothing runs):
/Coding/ENV/bin/python scripts/processing/bench/optimization_bench.py --list-tools

# The baseline (validator metadata, sizes, gzip):
/Coding/ENV/bin/python scripts/processing/bench/glb_baseline.py --format csv
/Coding/ENV/bin/python scripts/processing/bench/glb_baseline.py --include-gltf --format json

# The benchmark on repository GLBs (copies only):
/Coding/ENV/bin/python scripts/processing/bench/optimization_bench.py --format csv \
    content/models/npc-pip-pirate.glb react/public/models/kenney-tree-large.glb

# Texture compressors on local images (013 owns producing them):
/Coding/ENV/bin/python scripts/processing/bench/optimization_bench.py --image /path/to/albedo.png
```

## Result columns (`optimization_bench.py`)

| Column                                                                     | Meaning                                                                                                                                                        |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                                                   | `ok`, `skipped: tool not installed`, or `failed (exit N): <last stderr line>` (`exit -1` is the timeout)                                                       |
| `input_bytes`, `output_bytes`, `ratio`                                     | Sizes of the copy and the output; `ratio` = output / input                                                                                                     |
| `output_gzip9_bytes`                                                       | Estimated transfer size of the output with gzip level 9 (stdlib)                                                                                               |
| `wall_seconds`                                                             | Wall time of the tool process on this machine (not a Lambda figure)                                                                                            |
| `child_max_rss_kib`                                                        | `RUSAGE_CHILDREN` peak RSS, KiB on Linux; runs are sequential so it is an upper bound per run                                                                  |
| `validator_verdict`, `validator_errors`                                    | The existing GLB validator on the output. `needs_decoder` is expected for compressed outputs until the loader and validator changes in the report are approved |
| `extensions_used`, `extensions_required`, `vertex_count`, `triangle_count` | From the validator's metadata                                                                                                                                  |

## Reporting a run

Paste the CSV into the report's "Measured optimization results" section with: the commit SHA,
the date, the machine (CPU, architecture, OS), every tool version, and the exact command. A
wall time on a workstation is not a Lambda duration; Lambda runtime needs a separate measured
run after the native-tool ADR (see the proposal in
`docs/processing/proposals/ADR-PROPOSED-glb-optimization.md`). Visual parity (screenshots on a
tablet) is required before any lossy variant (simplification, ETC1S, quantization) is
considered acceptable.

## State on 2026-11-17

On the authoring machine no tool was on `PATH` by default (`--list-tools`). For the measured run
in feasibility section 6.2 a developer installed `gltfpack` 1.3 (npm, WASM build: no texture
compression), `gltf-transform` 4.5.1 and `toktx` 4.4.2 into a throwaway directory outside the
repository and put them on `PATH` for that one command. Nothing was added to the repository.

Additions in LAI-LAMBDA-010 Workstream D: the variants `gltf-transform-resize-1024`,
`gltf-transform-etc1s` and `gltf-transform-uastc`; an `original` row per input; per-command peak
RSS from GNU `time -f %M` (falls back to `RUSAGE_CHILDREN` when `time` is absent); and the
columns `animation_count`, `clip_names`, `texture_count`, `texture_gpu_mib` and
`texture_gpu_basis`. `texture_gpu_mib` is a formula (RGBA8 with a full mip chain for PNG and
JPEG; 8 bits per pixel with mips for KTX2), not a measurement.
