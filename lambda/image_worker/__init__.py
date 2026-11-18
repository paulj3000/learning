"""LAI image conversion worker (AWS Lambda, Python 3.12, arm64, zip with Pillow). ADR-068.

Entry point: `image_worker.handler.handle`. It is a thin layer over the canonical worker:
envelope parsing, redelivery handling, result storage and the results queue come from
`jobs_worker` (imported, never copied); the work is the ADR-061 execution engine running the
`asset.image_converter` processor of `processing/lai_native/image`, and every artifact is written
through `jobs_worker.aws.Runtime.artifact_storage` (create-only, one attempt prefix).
The zip is built by `native/pillow/build.py`.
"""
