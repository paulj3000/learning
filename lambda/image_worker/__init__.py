"""LAI image conversion worker (AWS Lambda, Python 3.12, arm64, zip with Pillow). ADR-068.

Entry point: `image_worker.handler.handle`. It is a thin layer over the canonical worker:
envelope parsing, redelivery handling, result storage and the results queue all come from
`jobs_worker` (imported, never copied); the image work is `processing/lai_native/image`.
The zip is built by `native/pillow/build.py`.
"""
