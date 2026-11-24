# Vulnerability note: Pillow 13.0.0 (checked 2026-11-18)

| Source                                                                                      | Result                                         |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| PyPI release metadata (`https://pypi.org/pypi/Pillow/13.0.0/json`, field `vulnerabilities`) | none listed                                    |
| OSV (`api.osv.dev` query, ecosystem PyPI, package `pillow`, version 13.0.0)                 | 0 advisories                                   |
| Same OSV query for Pillow 12.3.0 (the previous release)                                     | 62 advisories, so 13.0.0 is the fixed baseline |

Not checked (no machine-readable source used): advisories for the bundled C libraries (libwebp,
libjpeg-turbo, libtiff, OpenJPEG, lcms2, zstd, xz) beyond what Pillow's wheel build tracks. The
wheel is built against the library versions in `THIRD_PARTY_NOTICES.md`; libwebp 1.6.0 is past the
CVE-2023-4863 fixes (1.3.2).

Exposure in this function: untrusted images are decoded, but only PNG, JPEG and WebP
(`Image.open(..., formats=[...])`), after a byte-level sniff, size and pixel limits, and in a
function with no database, Bedrock, Polly or write access outside the artifact prefix. TIFF,
JPEG 2000, AVIF and fonts are present or removed as described but never reached by input.

Process: re-run this check and update `requirements-*.txt` for every Pillow release or advisory;
an upgrade is a new `PROCESSOR_VERSION`, a rebuilt zip (new hash) and a rerun of
`tests/native_image`. Subscribe to GitHub security advisories for `python-pillow/Pillow`. This
file records a point-in-time check; it is not a continuous scan.
