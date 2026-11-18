"""The image function's environment. Not a `jobs_worker.aws.Settings`: that class only knows
the `ai` and `media` queues. Workstream A registers the `image` queue in the envelope; until
then this class carries the same attributes `jobs_worker` reads."""

from __future__ import annotations

import os

KIND = "asset.convert_image"
QUEUE = "image"


class ImageSettings:
    def __init__(self, environ=None):
        env = os.environ if environ is None else environ
        self.queue = env.get("LAI_WORKER_QUEUE", QUEUE).strip()
        self.results_queue_url = env.get("LAI_RESULTS_QUEUE_URL", "").strip()
        self.results_bucket = env.get("LAI_RESULTS_BUCKET", "").strip()
        self.asset_bucket = env.get("LAI_ASSET_BUCKET", "").strip()
        self.speech_bucket = ""
        self.ssm_prefix = ""
        if self.queue != QUEUE:
            raise RuntimeError("LAI_WORKER_QUEUE must be image")
        if not self.results_queue_url or not self.results_bucket or not self.asset_bucket:
            raise RuntimeError(
                "LAI_RESULTS_QUEUE_URL, LAI_RESULTS_BUCKET and LAI_ASSET_BUCKET are required"
            )

    @property
    def allowed_kinds(self) -> frozenset[str]:
        return frozenset({KIND})
