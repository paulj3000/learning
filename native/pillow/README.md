# native/pillow

Reproducible packaging of the image conversion Lambda (ADR-068). Nothing here deploys.

```
python3 native/pillow/build.py --arch aarch64   # target: Lambda python3.12 arm64
python3 native/pillow/build.py --arch x86_64    # local tests and benchmarks
python3 native/pillow/build.py --arch aarch64 --wheel DIR   # offline, wheel already in DIR
python3 native/pillow/build.py --arch aarch64 --wheel DIR --sbom native/pillow/sbom-aarch64.cdx.json
```

Output goes to `build/image/` (gitignored): `image-worker-<arch>-<hash16>.zip` and a `.json`
manifest with the sizes. See `docs/processing/IMAGE_CONVERSION.md` for the measured sizes, the
contents, the pruning rules and the test commands.

Files: `requirements-<arch>.txt` (Pillow pinned with `--hash`), `build.py`,
`THIRD_PARTY_NOTICES.md` (licences, what is bundled and what is removed),
`VULNERABILITIES.md` (point-in-time advisory check), `sbom-<arch>.cdx.json` (CycloneDX
bill of materials of the function zip), `bench.py` (time and peak memory at realistic limits;
x86 workstation only).
