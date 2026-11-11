"""No two URL patterns share a route (found when AMP-03 and the NPC Manager both claimed npcs/).

Django resolves the first matching pattern silently, so a duplicate makes one view unreachable
without any error. This walks the real URLconf and fails on any repeated route.
"""

from collections import Counter

from django.urls import URLPattern, URLResolver, get_resolver


def _routes(resolver: URLResolver, prefix: str = ""):
    for pattern in resolver.url_patterns:
        route = prefix + str(pattern.pattern)
        if isinstance(pattern, URLResolver):
            yield from _routes(pattern, route)
        elif isinstance(pattern, URLPattern):
            yield route


def test_every_route_is_unique():
    counts = Counter(_routes(get_resolver()))
    assert [route for route, count in counts.items() if count > 1] == []


def test_npc_routes_are_split_between_the_catalog_and_npc_memory():
    routes = set(_routes(get_resolver()))
    assert "api/v1/children/<uuid:child_id>/npcs/" in routes  # NPC Manager catalog
    assert "api/v1/children/<uuid:child_id>/npc-memory/" in routes  # AMP-03 relationships
