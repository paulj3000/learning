import io

from apps.assets import services as asset_services
from apps.assets.tests.helpers import make_definition
from apps.assets.tests.media_files import wav_bytes
from apps.audio.models import SoundAssignment, SoundCue


def audio_asset(asset_id="coin-clink", *, category="sound", publish=True, seconds=1):
    """A managed audio asset, optionally with a published (default) version."""
    asset = make_definition(asset_id, kind="audio", category=category)
    version = asset_upload(asset, seconds=seconds)
    if publish:
        version = asset_services.publish_version(version)
    asset.refresh_from_db()
    return asset, version


def asset_upload(asset, *, seconds=1):
    return asset_services.upload_version(
        asset, io.BytesIO(wav_bytes(seconds=seconds)), original_filename="a.wav"
    )


def cue(cue_id="sfx.coin.collect", asset=None, **fields):
    asset = asset or audio_asset(cue_id.replace(".", "-").replace("_", "-"))[0]
    defaults = {"name": cue_id, "channel": cue_id.split(".")[0], "asset": asset}
    obj = SoundCue(cue_id=cue_id, **{**defaults, **fields})
    obj.full_clean()
    obj.save()
    return obj


def assign(cue_obj, *, target_type="scope", target_id="", event="on_enter", **scope):
    obj = SoundAssignment(
        cue=cue_obj, target_type=target_type, target_id=target_id, event=event, **scope
    )
    obj.full_clean()
    obj.save()
    return obj
