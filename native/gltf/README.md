# GLB optimization tools (LAI-LAMBDA-010, ADR-070)

Pinned native tools for `processing/lai_native/optimize`. Nothing in this directory is a binary:
`fetch-tools.sh` downloads the pinned release archives, verifies SHA-256 **before** extracting,
and extracts into the gitignored `build/native/gltf/<arch>/`. Binaries are build outputs and are
never committed.

```sh
native/gltf/fetch-tools.sh > /tmp/lai-gltf-tools.env   # x86_64 by default; --arch arm64
source /tmp/lai-gltf-tools.env                          # LAI_GLTFPACK, LAI_TOKTX, LAI_KTX
python3 native/gltf/bench.py --profile meshopt-conservative content/models/npc-pip-pirate.glb
```

## Pinned sources (`tools.lock`)

| Tool                                    | Version | Source                                                           | SHA-256                                           | Licence                                                                                  | x86_64                                         | arm64                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ------- | ---------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gltfpack` (meshoptimizer)              | 1.3     | `gltfpack-ubuntu.zip`, GitHub release v1.3                       | `0666d9dc...6017`                                 | MIT                                                                                      | Prebuilt (4.1 MB ELF; has texture compression) | **No Linux arm64 binary is published.** Build from `meshoptimizer-1.3.tar.gz` (`d50a0b5e...7b77`) with CMake, `-DMESHOPT_BUILD_GLTFPACK=ON -DMESHOPT_GLTFPACK_BASISU_PATH=<basis_universal checkout>`. CMake is not installed on the development host, so this was **not built or measured** |
| KTX-Software (`toktx`, `ktx`, `libktx`) | 4.4.2   | `KTX-Software-4.4.2-Linux-<arch>.tar.bz2`, GitHub release v4.4.2 | x86_64 `a8781bad...a245`; arm64 `60382e7b...5c5a` | Apache-2.0 (bundles Basis Universal, Apache-2.0, and third-party notices in the archive) | Prebuilt, measured here                        | Prebuilt tarball pinned; **not run** (no arm64 host)                                                                                                                                                                                                                                         |

The digests are GitHub's release-asset digests, re-computed locally after download on
2026-11-18. KTX-Software 5.0.0 is still a release candidate (rc2 on 2026-11-18), so 4.4.2 stays
pinned.

The npm `gltfpack` package (1.3.0, `sha512-YGt2vPUa...W/xQ==`, a WASM build) was used by the
feasibility study; it has **no texture compression** (`-tc` fails), so the native binary is the
pinned tool. Nothing here adds a dependency to `package.json` or any requirements file.

## Licences

- meshoptimizer / gltfpack: MIT (`LICENSE.md` in the archive).
- KTX-Software: Apache-2.0; its archive ships `LICENSE.md` and the licences of bundled
  components (Basis Universal Apache-2.0, Zstandard BSD-3-Clause, and others listed there).
- basis_universal (inside gltfpack's texture path and `toktx`): Apache-2.0.

A deployment that ships these binaries must carry the licence files with them (ADR-070 open
decision on packaging).

## Facts verified from the gltfpack 1.3 source (`gltf/gltfpack.cpp`)

- `-c`/`-cc` write `EXT_meshopt_compression`; `-ce khr` and `-cz` write
  `KHR_meshopt_compression` (so gltfpack **can** emit the KHR name; the profiles never ask for
  it and the validators reject it).
- `-af` defaults to 30 Hz resampling; the profile passes `-af 0`.
- `-kn` keeps named nodes, but with the default integer position quantization a skinned mesh is
  moved under a new unnamed child node carrying the dequantization transform (observed on the
  repository NPC). `-vpf` avoids that; `-vtf` avoids adding `KHR_texture_transform`.
