"""Stable, log-safe failure codes for image conversion. Messages never carry pixel data,
metadata values, file names or paths."""


class ImageError(Exception):
    """A conversion that cannot proceed. `code` is a stable snake_case string."""

    def __init__(self, code: str, *, retryable: bool = False):
        super().__init__(code)
        self.code = code
        self.retryable = retryable


#: The codes this package raises (the contract's error table, docs/processing/IMAGE_CONVERSION.md).
CODES = frozenset(
    {
        "input_too_large",
        "unsupported_format",
        "malformed_image",
        "image_too_large",
        "animated_not_supported",
        "bit_depth_not_supported",
        "colour_profile_invalid",
        "colour_mode_not_supported",
        "alpha_not_supported",
        "output_too_large",
        "output_check_failed",
        "invalid_profile",
        "pillow_unavailable",
    }
)
