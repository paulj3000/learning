"""AM-8/AM-9: every model the game ships today passes the asset manager's validation.

Imports the real content export, then dry-runs the bundled import against the real
`react/public` files. Writes nothing to storage.
"""

import pytest

from apps.assets.importer import import_bundled
from apps.catalog.importer import import_content

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def test_every_shipped_bundled_model_validates():
    import_content()
    report = import_bundled(dry_run=True)
    assert report.imported, "the export should name bundled models"
    assert report.unresolved == []
