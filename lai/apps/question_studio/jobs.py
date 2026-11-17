"""Question Studio's background job handler (`studio.generate_chunk`, apps.jobs).

`apply(job)` is the result handler: it applies the chunk with the same accounting the in-process
runners use and submits the next chunk (generation.apply_chunk_job). `inline_ports(job)` lets the
inline jobs backend run the worker's task code in-process with the Studio's own model client
(the fake one in tests and local development).
"""

from apps.ai.providers.base import ContentPart, ModelRequest, ProviderConfigurationError

from . import generation
from .models import GenerationBatch


def apply(job) -> None:
    generation.apply_chunk_job(job)


class InlinePorts:
    def __init__(self, job):
        self.studio_model_id = generation.studio_model_id()
        self.approved_model_ids = list(generation.approved_model_ids())
        self._client = generation.studio_client()
        batch = GenerationBatch.objects.filter(pk=job.payload.get("batch_id")).first()
        # The fake model builds deterministic questions from the batch's parameters; a real
        # model never sees `fake_hints`.
        self._hints = (
            {
                "studio": True,
                "count": job.payload.get("want"),
                "params": generation._params_of(batch),  # noqa: SLF001
                "offset": job.payload.get("offset", 0),
            }
            if batch is not None
            else {}
        )

    def invoke_model(self, request: dict):
        if self._client is None:
            raise ProviderConfigurationError
        return self._client.invoke(
            ModelRequest(
                route=request["route"],
                system_prompt=request["system_prompt"],
                content=tuple(ContentPart(**part) for part in request["content"]),
                output_schema=request["output_schema"],
                schema_name=request["schema_name"],
                max_output_tokens=request["max_output_tokens"],
                temperature=request["temperature"],
                fake_hints=self._hints,
            )
        )


def inline_ports(job) -> InlinePorts:
    return InlinePorts(job)
