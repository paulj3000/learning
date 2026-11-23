"""Native processing runtimes (FFmpeg, Pillow, gltfpack, KTX tools).

Kept separate from the standard-library `lai_processing` package: only this package may run
native tools or import native libraries, through its own import allowlist. See
`docs/processing/COMPLETION_INTEGRATION.md`.
"""
