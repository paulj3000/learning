"""LAI-07 W2-5: a disabled avatar is a historical usage; draft avatars stay informational."""

import pytest

from apps.assets.models import VersionStatus
from apps.assets.tests.helpers import make_definition, make_version
from apps.avatars import dependencies
from apps.avatars.models import PlayerAvatar
from apps.avatars.vocabulary import AvatarStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.mark.parametrize(
    ("status", "blocks", "historical"),
    [
        (AvatarStatus.AVAILABLE, True, False),
        (AvatarStatus.DRAFT, False, False),
        (AvatarStatus.DISABLED, False, True),
    ],
)
def test_historical_flag_by_status(status, blocks, historical):
    asset = make_definition("player-fox", category="character")
    v1 = make_version(asset, 1, status=VersionStatus.PUBLISHED)
    asset.default_version = v1
    asset.save()
    thumb = make_definition("fox-thumb", category="character")
    row = PlayerAvatar.objects.get(avatar_key="FOX")
    row.model_asset, row.status, row.thumbnail_asset = asset, status, thumb
    row.save()

    (model_usage,) = dependencies.usages(asset)
    assert (model_usage.blocks_retirement, model_usage.historical) == (blocks, historical)
    (thumb_usage,) = dependencies.usages(thumb)
    assert (thumb_usage.blocks_retirement, thumb_usage.historical) == (
        False,
        status == AvatarStatus.DISABLED,
    )
