"""ChallengeSpec rows are always valid TR-1 parameters (TR-2)."""

import pytest
from django.core.exceptions import ValidationError

from apps.education.models import ChallengeSpec
from apps.users.models import AgeBand


def spec(**overrides) -> ChallengeSpec:
    values = {
        "slug": "spec",
        "title": "Spec",
        "age_band": AgeBand.SPROUT,
        "skill_id": "counting-sets",
        "min_value": 1,
        "max_value": 5,
        "response_mode": "CHOICE",
        "choice_count": 3,
    }
    return ChallengeSpec(**{**values, **overrides})


ADD = {"skill_id": "addition-within-ten", "min_value": 0, "max_value": 10}
TYPED = {"response_mode": "NUMBER_INPUT", "choice_count": 0}


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"age_band": "TODDLER"}, "unknown_age_band"),
        ({"skill_id": "long-division"}, "unknown_skill"),
        ({**ADD, "max_value": 5}, "skill_not_for_age_band"),
        ({"max_value": 6}, "max_value_above_age_band_limit"),
        ({"age_band": AgeBand.PATHFINDER, "max_value": 11}, "max_value_above_skill_limit"),
        (TYPED, "response_mode_not_for_age_band"),
        ({"choice_count": 4}, "choice_count_out_of_range"),
        ({"choice_count": 1}, "choice_count_out_of_range"),
        ({**ADD, "age_band": AgeBand.EXPLORER, "choice_count": 2, "response_mode": "NUMBER_INPUT"},
         "choice_count_without_choices"),
        ({**ADD, **TYPED, "age_band": AgeBand.EXPLORER, "min_value": -1}, "min_value_negative"),
        ({**ADD, **TYPED, "age_band": AgeBand.EXPLORER, "min_value": 6}, "range_too_small"),
        ({"min_value": 4, "max_value": 3}, "range_too_small"),
        ({"max_value": 2}, "range_too_small_for_choices"),
    ],
)
def test_every_tr1_error_code_is_a_validation_error(overrides, code):
    with pytest.raises(ValidationError) as raised:
        spec(**overrides).clean()
    assert code in [error.code for error in raised.value.error_list]


def test_valid_parameters_pass_and_round_trip():
    row = spec()
    row.clean()
    assert row.parameters().choice_count == 3


@pytest.mark.postgres
@pytest.mark.django_db
def test_saving_invalid_parameters_is_refused():
    with pytest.raises(ValidationError):
        spec(max_value=9).save()
    assert not ChallengeSpec.objects.exists()
