"""Synthetic definitions, versions and model files for the asset manager tests. No AWS."""

import base64
import hashlib
import json
import struct

from django.utils.timezone import now

from apps.assets.models import AssetVersion, ModelFormat, VersionStatus
from apps.catalog.models import AssetOrigin, ContentAsset


def make_definition(asset_id="npc-pip", *, kind="character", category="npc", **fields):
    return ContentAsset.objects.create(
        asset_id=asset_id,
        kind=kind,
        category=category,
        origin=AssetOrigin.DJANGO,
        display_name=fields.pop("display_name", asset_id.replace("-", " ").title()),
        **fields,
    )


def make_version(asset, number=None, *, status=VersionStatus.VALIDATED, **fields):
    """A version row written straight to the database (services are tested separately)."""
    number = number or (asset.versions.count() + 1)
    stamp = now()
    published = status in (VersionStatus.PUBLISHED, VersionStatus.RETIRED)
    values = {
        "asset": asset,
        "number": number,
        "status": status,
        "storage_key": f"assets/models/{asset.asset_id}/v{number}-{stamp.timestamp()}/model.glb",
        "original_filename": f"{asset.asset_id}.glb",
        "content_type": "model/gltf-binary",
        "size_bytes": 1024,
        "sha256": hashlib.sha256(f"{asset.asset_id}-{number}".encode()).hexdigest(),
        "format": ModelFormat.GLB,
        "clips": ["Idle"],
        "validated_at": stamp if status != VersionStatus.DRAFT else None,
        "published_at": stamp if published else None,
        "retired_at": stamp if status == VersionStatus.RETIRED else None,
    }
    values.update(fields)
    return AssetVersion.objects.create(**values)


# --- model files -------------------------------------------------------------------------------


def _pad(data: bytes, filler: bytes) -> bytes:
    return data + filler * (-len(data) % 4)


def gltf_document(*, clips=("Idle",), extra=None, half_size=(0.5, 1.0, 0.25), buffer_uri=None):
    """A minimal valid glTF 2.0 document: one triangle-sized box of POSITION data, one node."""
    positions = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    times = struct.pack("<2f", 0.0, 1.0)
    translations = struct.pack("<6f", 0, 0, 0, 0, 0.1, 0)
    binary = positions + times + translations
    hx, hy, hz = half_size
    document = {
        "asset": {"version": "2.0", "generator": "lai-tests"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "body"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": 36},
            {"buffer": 0, "byteOffset": 36, "byteLength": 8},
            {"buffer": 0, "byteOffset": 44, "byteLength": 24},
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": 3,
                "type": "VEC3",
                "min": [-hx, -hy, -hz],
                "max": [hx, hy, hz],
            },
            {"bufferView": 1, "componentType": 5126, "count": 2, "type": "SCALAR",
             "min": [0.0], "max": [1.0]},
            {"bufferView": 2, "componentType": 5126, "count": 2, "type": "VEC3"},
        ],
        "animations": [
            {
                "name": clip,
                "samplers": [{"input": 1, "output": 2}],
                "channels": [{"sampler": 0, "target": {"node": 0, "path": "translation"}}],
            }
            for clip in clips
        ],
    }
    if buffer_uri is not None:
        document["buffers"][0]["uri"] = buffer_uri
    if extra:
        document.update(extra)
    return document, binary


def glb_bytes(document=None, binary=None, **options) -> bytes:
    if document is None:
        document, binary = gltf_document(**options)
    json_chunk = _pad(json.dumps(document).encode(), b" ")
    bin_chunk = _pad(binary or b"", b"\x00")
    body = struct.pack("<II", len(json_chunk), 0x4E4F534A) + json_chunk
    if bin_chunk:
        body += struct.pack("<II", len(bin_chunk), 0x004E4942) + bin_chunk
    return struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body


def gltf_json_bytes(**options) -> bytes:
    """A self-contained .gltf: the buffer embedded as a base64 data URI."""
    document, binary = gltf_document(**options)
    encoded = base64.b64encode(binary).decode()
    document["buffers"][0]["uri"] = f"data:application/octet-stream;base64,{encoded}"
    return json.dumps(document).encode()
