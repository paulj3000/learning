import datetime as dt

import pytest

from apps.seasons.availability import in_window, season_year
from apps.seasons.models import Availability, SeasonalEvent


def event(start=(12, 1), end=(1, 6), **kw):
    fields = {}
    if start:
        fields = dict(
            window_start_month=start[0],
            window_start_day=start[1],
            window_end_month=end[0],
            window_end_day=end[1],
        )
    return SeasonalEvent(slug="e", title="E", **fields, **kw)


D = dt.date


@pytest.mark.parametrize(
    "date,expected",
    [
        (D(2026, 12, 1), True),
        (D(2026, 12, 31), True),
        (D(2027, 1, 1), True),
        (D(2027, 1, 6), True),
        (D(2027, 1, 7), False),
        (D(2026, 11, 30), False),
        (D(2026, 7, 4), False),
    ],
)
def test_window_crossing_the_new_year(date, expected):
    assert in_window(event(), date) is expected


@pytest.mark.parametrize(
    "date,expected",
    [(D(2026, 10, 1), True), (D(2026, 10, 31), True), (D(2026, 9, 30), False), (D(2026, 11, 1), False)],
)
def test_window_inside_one_year(date, expected):
    assert in_window(event((10, 1), (10, 31)), date) is expected


def test_feb_29_edges():
    e = event((2, 20), (2, 29))
    assert in_window(e, D(2028, 2, 29))
    assert in_window(e, D(2027, 2, 28))
    assert not in_window(e, D(2027, 3, 1))
    assert in_window(event((2, 29), (3, 5)), D(2028, 2, 29))


def test_a_single_day_window_and_no_window():
    assert in_window(event((7, 4), (7, 4)), D(2026, 7, 4))
    assert not in_window(event((7, 4), (7, 4)), D(2026, 7, 5))
    assert not in_window(event(None, availability=Availability.YEAR_ROUND), D(2026, 12, 25))


def test_season_year():
    e = event()
    assert season_year(e, D(2026, 12, 25)) == 2026
    assert season_year(e, D(2027, 1, 3)) == 2026
    assert season_year(event((10, 1), (10, 31)), D(2026, 10, 5)) == 2026
    assert season_year(event(None), D(2026, 5, 5)) == 2026
