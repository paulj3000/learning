"""Shared pytest hooks for the Django project."""

import os

import pytest


def pytest_collection_modifyitems(config, items):
    """Tests marked `postgres` need the compose PostgreSQL (`make up`).

    They are skipped when it is unreachable, unless LAI_REQUIRE_POSTGRES=1 (`make py-test-db`),
    in which case an unreachable database fails them instead of hiding the gap.
    """
    if os.environ.get("LAI_REQUIRE_POSTGRES") == "1":
        return
    import socket

    port = int(os.environ.get("POSTGRES_PORT", "5432"))
    try:
        socket.create_connection(("127.0.0.1", port), timeout=1).close()
        return
    except OSError:
        pass
    skip = pytest.mark.skip(reason="PostgreSQL not reachable on loopback; run `make up`")
    for item in items:
        if "postgres" in item.keywords:
            item.add_marker(skip)
