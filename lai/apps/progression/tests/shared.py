"""A module-scoped content import for tests that only read the catalog.

`import_content()` is slow, so a module can import the export once inside an outer transaction
that is rolled back at the end; each test's own transaction nests inside it. Not for
`transaction=True` tests (they flush the database)."""

import pytest
from django.db import transaction

from apps.catalog.importer import import_content
from apps.progression import stories


@pytest.fixture(scope="module")
def imported_content(django_db_setup, django_db_blocker):
    with django_db_blocker.unblock():
        outer = transaction.atomic()
        outer.__enter__()
        try:
            import_content()
            stories.definitions.cache_clear()
            yield
        finally:
            transaction.set_rollback(True)
            outer.__exit__(None, None, None)
