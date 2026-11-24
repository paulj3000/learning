# Third party notices for the image function (Pillow 13.0.0, linux arm64 and x86_64 wheels)

The image function zip carries Pillow and the shared libraries its manylinux wheel bundles.
`pillow-13.0.0.dist-info/licenses/LICENSE` inside the zip is the full upstream licence text for
every bundled component (sections AOM, BROTLI, BZIP2, DAV1D, FREETYPE2, HARFBUZZ, LCMS2, LIBAVIF,
LIBJPEG, LIBLZMA, LIBPNG, LIBTIFF, LIBWEBP, LIBYUV, OPENJPEG, RAQM, TCL_TK, XAU, XCB, XDMCP, ZLIB,
ZSTD) and `pillow-13.0.0.dist-info/sboms/*.cdx.json` is the wheel's own SBOM. This page is the
summary and the record of what the build keeps. Versions come from the wheel SBOM
(`pillow-13.0.0.cdx.json`, read 2026-11-18).

Pillow itself: **MIT-CMU** (HPND style: permission to use, copy, modify and distribute without
fee, copyright notice kept in copies; no use of the author's name in advertising).

| Component                                   | Version                | Licence (SPDX)                                             | In the function zip                                                                         |
| ------------------------------------------- | ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Pillow                                      | 13.0.0                 | MIT-CMU                                                    | yes (pruned, see below)                                                                     |
| libjpeg-turbo                               | 3.2.0                  | IJG and BSD-3-Clause                                       | yes (`libjpeg`)                                                                             |
| libwebp (with sharpyuv, webpmux, webpdemux) | 1.6.0                  | BSD-3-Clause                                               | yes                                                                                         |
| libtiff                                     | 4.7.2                  | libtiff (BSD-like)                                         | yes (linked by `_imaging`; TIFF is never opened)                                            |
| OpenJPEG                                    | 2.5.4                  | BSD-2-Clause                                               | yes (linked by `_imaging`; JPEG 2000 is never opened)                                       |
| Little CMS 2                                | 2.19.1                 | MIT                                                        | yes (colour profile conversion)                                                             |
| libxcb, libXau                              | 1.17.0, 1.0.9          | X11 / MIT-style                                            | yes (linked by `_imaging`; screen grab is pruned)                                           |
| zstd                                        | 1.5.7                  | BSD-3-Clause (dual with GPL-2.0; BSD chosen)               | yes (needed by libtiff)                                                                     |
| liblzma (XZ Utils)                          | 5.8.4                  | public domain / 0BSD                                       | yes (needed by libtiff)                                                                     |
| zlib                                        | system                 | Zlib                                                       | no: `libz.so.1` comes from the Lambda runtime (Amazon Linux 2023)                           |
| libavif, dav1d, aom, libyuv                 | 1.4.2                  | BSD-2-Clause                                               | **removed** (AVIF is never opened)                                                          |
| FreeType, HarfBuzz, Raqm, Brotli, libpng    | 2.14.3, 14.5.0, 0.11.0 | FTL or GPL-2.0 (FreeType), MIT, MIT, PNG Reference Library | **removed** (text rendering is never used)                                                  |
| FriBiDi                                     | 1.0.17                 | LGPL-2.1-or-later                                          | not bundled (the wheel loads it from the system only if present; never present)             |
| libimagequant                               | 4.4.1                  | GPL-3.0-or-later                                           | not bundled (optional system library, absent on Lambda; `quantize` with it is never called) |
| pybind11, pythoncapi_compat                 |                        | BSD-3-Clause, 0BSD                                         | build-time sources compiled into the extensions                                             |

Notes for the owner (decisions listed in ADR-068):

- Nothing in the zip is copyleft. The two copyleft packages in the wheel SBOM (FriBiDi LGPL,
  libimagequant GPL-3.0) are not bundled; they are optional runtime lookups and are absent in the
  Lambda runtime. A test (`tests/native_image/test_pillow_packaging.py`) asserts neither library
  file is in the zip.
- Removed components are removed to cut size and attack surface (AVIF and font parsers are the
  most frequently patched code in the wheel), not for licence reasons.
- The zip is used only inside our own AWS account. No Pillow or library source modification is
  made; licence texts travel with the zip.
