"""Publication status for content authored outside the export (POST-MERGE-03).

Used by the Treasure Rush region rows and challenge specs, which the seed authors (not the
export). Only PUBLISHED content is served to a child. Imported catalog rows use `active`.
"""

from django.db import models


class ContentStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    PUBLISHED = "PUBLISHED", "Published"
    RETIRED = "RETIRED", "Retired"
