"""Estimated model cost per turn (LAI-0708). An estimate, never a bill.

Prices are configuration, not code, because they differ by model, inference profile and date,
and Claude usage on Bedrock is billed through AWS Marketplace: read them from the Bedrock pricing
page for the configured model id and set `LAI_AI_PRICE_INPUT_PER_MTOK_USD` and
`LAI_AI_PRICE_OUTPUT_PER_MTOK_USD` (USD per million tokens), with `LAI_AI_PRICE_TABLE_VERSION`
naming where and when they were read. With no price configured, or no usage reported by Bedrock,
the estimate is None: nothing is made up.
"""

from django.conf import settings


def estimate_microusd(input_tokens: int | None, output_tokens: int | None) -> int | None:
    price_in = settings.LAI_AI_PRICE_INPUT_PER_MTOK_USD
    price_out = settings.LAI_AI_PRICE_OUTPUT_PER_MTOK_USD
    if price_in is None or price_out is None or input_tokens is None or output_tokens is None:
        return None
    # USD per million tokens is exactly micro-USD per token.
    return round(input_tokens * price_in + output_tokens * price_out)
