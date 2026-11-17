"""Learning Adventure Island background processing (LAI-LAMBDA-001, ADR-061).

Runtime-independent: standard library only. No Django, boto3, AWS Lambda, HTTP or database
imports anywhere in this package. Adapters for those runtimes live outside it (Wave 2).
"""

from .version import __version__

__all__ = ["__version__"]
