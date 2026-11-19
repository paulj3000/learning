"""Read-only metadata probes for asset files (the `asset.inspect` job).

Pure Python, no third-party parser: a glTF 2.0 binary (GLB) header and JSON chunk, a self-
contained glTF JSON file, PNG/JPEG/WebP dimensions and MP3/WAV/Ogg basics. Every probe reads
through `read(start, length) -> bytes` so the worker can fetch byte ranges instead of whole
objects. Probes never raise on bad input: what they cannot read becomes a `problems` entry (a
stable code, never file content). Names and URIs inside a glTF file are never copied out.
"""

import json
import struct
from collections.abc import Callable

Reader = Callable[[int, int], bytes]

#: The largest GLB JSON chunk or .gltf file a probe will parse.
MAX_JSON_BYTES = 16 * 1024 * 1024
#: How much of an image or audio file a probe looks at.
HEAD_BYTES = 256 * 1024

_GLB_MAGIC = b"glTF"
_CHUNK_JSON = 0x4E4F534A
_CHUNK_BIN = 0x004E4942
_COUNTED = (
    "scenes",
    "nodes",
    "meshes",
    "materials",
    "textures",
    "images",
    "samplers",
    "animations",
    "skins",
    "cameras",
    "accessors",
    "bufferViews",
    "buffers",
)


def _strings(value: object, limit: int = 40) -> list[str]:
    if not isinstance(value, list):
        return []
    return sorted({item[:80] for item in value if isinstance(item, str)})[:limit]


def _gltf_summary(document: object, problems: list[str], *, bin_length: int | None) -> dict:
    if not isinstance(document, dict):
        problems.append("json_not_object")
        return {}
    asset = document.get("asset") if isinstance(document.get("asset"), dict) else {}
    version = asset.get("version") if isinstance(asset.get("version"), str) else ""
    if not version:
        problems.append("asset_version_missing")
    elif not version.startswith("2."):
        problems.append("asset_version_not_2")
    summary: dict = {
        "assetVersion": version[:16],
        "minVersion": str(asset.get("minVersion", ""))[:16],
        "generator": str(asset.get("generator", ""))[:120],
        "counts": {
            name: len(document[name]) if isinstance(document.get(name), list) else 0
            for name in _COUNTED
        },
        "extensionsUsed": _strings(document.get("extensionsUsed")),
        "extensionsRequired": _strings(document.get("extensionsRequired")),
    }
    buffers = document.get("buffers") if isinstance(document.get("buffers"), list) else []
    sizes, external = [], 0
    for index, buffer in enumerate(buffers[:64]):
        if not isinstance(buffer, dict):
            problems.append("buffer_not_object")
            continue
        length = buffer.get("byteLength")
        sizes.append(length if isinstance(length, int) and length >= 0 else None)
        uri = buffer.get("uri")
        if isinstance(uri, str) and not uri.startswith("data:"):
            external += 1
        if index == 0 and uri is None and bin_length is not None and isinstance(length, int):
            if length > bin_length:
                problems.append("buffer_larger_than_bin_chunk")
    summary["bufferSizes"] = sizes
    if external:
        summary["externalBuffers"] = external
        problems.append("external_buffer_uri")
    images = document.get("images") if isinstance(document.get("images"), list) else []
    if any(
        isinstance(i, dict) and isinstance(i.get("uri"), str) and not i["uri"].startswith("data:")
        for i in images
    ):
        problems.append("external_image_uri")
    unsupported = set(summary["extensionsRequired"]) - set(summary["extensionsUsed"])
    if unsupported:
        problems.append("required_extension_not_used")
    return summary


def probe_glb(read: Reader, size: int) -> dict:
    problems: list[str] = []
    meta: dict = {"container": "glb", "byteLength": size}
    header = read(0, 20)
    if len(header) < 12 or header[:4] != _GLB_MAGIC:
        return {**meta, "problems": ["not_glb"]}
    version, declared = struct.unpack_from("<II", header, 4)
    meta["glbVersion"] = version
    meta["declaredLength"] = declared
    if version != 2:
        problems.append("glb_version_not_2")
    if declared != size:
        problems.append("length_mismatch")
    if len(header) < 20:
        return {**meta, "problems": [*problems, "json_chunk_missing"]}
    json_length, json_type = struct.unpack_from("<II", header, 12)
    if json_type != _CHUNK_JSON:
        return {**meta, "problems": [*problems, "json_chunk_missing"]}
    if json_length > MAX_JSON_BYTES or 20 + json_length > size:
        return {**meta, "jsonChunkLength": json_length, "problems": [*problems, "json_too_large"]}
    meta["jsonChunkLength"] = json_length
    bin_length = None
    bin_header_at = 20 + json_length
    if bin_header_at + 8 <= size:
        bin_header = read(bin_header_at, 8)
        if len(bin_header) == 8:
            length, chunk_type = struct.unpack("<II", bin_header)
            if chunk_type == _CHUNK_BIN:
                bin_length = length
                meta["binChunkLength"] = length
                if bin_header_at + 8 + length > size:
                    problems.append("bin_chunk_truncated")
            else:
                problems.append("unexpected_second_chunk")
    raw = read(20, json_length)
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return {**meta, "problems": [*problems, "json_invalid"]}
    meta.update(_gltf_summary(document, problems, bin_length=bin_length))
    meta["problems"] = problems
    return meta


def probe_gltf(read: Reader, size: int) -> dict:
    meta: dict = {"container": "gltf", "byteLength": size}
    if size > MAX_JSON_BYTES:
        return {**meta, "problems": ["json_too_large"]}
    try:
        document = json.loads(read(0, size).decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return {**meta, "problems": ["json_invalid"]}
    problems: list[str] = []
    meta.update(_gltf_summary(document, problems, bin_length=None))
    meta["problems"] = problems
    return meta


def probe_png(head: bytes) -> dict:
    if len(head) < 26 or head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        return {"problems": ["not_png"]}
    width, height, depth, colour = struct.unpack_from(">IIBB", head, 16)
    return {
        "width": width,
        "height": height,
        "bitDepth": depth,
        "colourType": colour,
        "problems": [],
    }


_SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def probe_jpeg(head: bytes) -> dict:
    if head[:2] != b"\xff\xd8":
        return {"problems": ["not_jpeg"]}
    at = 2
    while at + 4 <= len(head):
        if head[at] != 0xFF:
            return {"problems": ["jpeg_marker_invalid"]}
        marker = head[at + 1]
        if marker == 0xFF:
            at += 1
            continue
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            at += 2
            continue
        (length,) = struct.unpack_from(">H", head, at + 2)
        if marker in _SOF:
            if at + 9 > len(head):
                break
            precision, height, width, components = struct.unpack_from(">BHHB", head, at + 4)
            return {
                "width": width,
                "height": height,
                "bitDepth": precision,
                "components": components,
                "progressive": marker == 0xC2,
                "problems": [],
            }
        if marker == 0xDA:  # start of scan before any frame header
            return {"problems": ["jpeg_frame_missing"]}
        at += 2 + length
    return {"problems": ["jpeg_frame_not_in_head"]}


def probe_webp(head: bytes) -> dict:
    if len(head) < 30 or head[:4] != b"RIFF" or head[8:12] != b"WEBP":
        return {"problems": ["not_webp"]}
    chunk = head[12:16]
    if chunk == b"VP8 " and head[23:26] == b"\x9d\x01\x2a":
        width, height = struct.unpack_from("<HH", head, 26)
        return {
            "width": width & 0x3FFF,
            "height": height & 0x3FFF,
            "encoding": "lossy",
            "problems": [],
        }
    if chunk == b"VP8L" and head[20] == 0x2F:
        bits = int.from_bytes(head[21:25], "little")
        return {
            "width": (bits & 0x3FFF) + 1,
            "height": ((bits >> 14) & 0x3FFF) + 1,
            "encoding": "lossless",
            "problems": [],
        }
    if chunk == b"VP8X":
        width = int.from_bytes(head[24:27], "little") + 1
        height = int.from_bytes(head[27:30], "little") + 1
        flags = head[20]
        return {
            "width": width,
            "height": height,
            "encoding": "extended",
            "animated": bool(flags & 0x02),
            "alpha": bool(flags & 0x10),
            "problems": [],
        }
    return {"problems": ["webp_chunk_unknown"]}


def probe_wav(head: bytes, size: int) -> dict:
    if len(head) < 12 or head[:4] != b"RIFF" or head[8:12] != b"WAVE":
        return {"problems": ["not_wav"]}
    at, meta = 12, {}
    while at + 8 <= len(head):
        chunk, length = head[at : at + 4], struct.unpack_from("<I", head, at + 4)[0]
        if chunk == b"fmt " and at + 24 <= len(head):
            fmt, channels, rate, byte_rate, _align, bits = struct.unpack_from(
                "<HHIIHH", head, at + 8
            )
            meta = {
                "audioFormat": fmt,
                "channels": channels,
                "sampleRate": rate,
                "bitsPerSample": bits,
                "byteRate": byte_rate,
            }
        elif chunk == b"data":
            if meta.get("byteRate"):
                meta["durationSeconds"] = round(min(length, size) / meta["byteRate"], 3)
            break
        at += 8 + length + (length & 1)
    if not meta:
        return {"problems": ["wav_fmt_missing"]}
    return {**meta, "problems": []}


def probe_ogg(head: bytes) -> dict:
    if head[:4] != b"OggS" or len(head) < 28:
        return {"problems": ["not_ogg"]}
    segments = head[26]
    body = 27 + segments
    packet = head[body : body + 32]
    if packet[:7] == b"\x01vorbis" and len(packet) >= 16:
        channels = packet[11]
        (rate,) = struct.unpack_from("<I", packet, 12)
        return {"codec": "vorbis", "channels": channels, "sampleRate": rate, "problems": []}
    if packet[:8] == b"OpusHead" and len(packet) >= 16:
        channels = packet[9]
        (rate,) = struct.unpack_from("<I", packet, 12)
        return {"codec": "opus", "channels": channels, "inputSampleRate": rate, "problems": []}
    return {"problems": ["ogg_codec_unknown"]}


_MP3_BITRATES = {  # MPEG-1 layer III, MPEG-2/2.5 layer III (kbit/s)
    3: (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0),
    2: (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0),
}
_MP3_RATES = {3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}


def probe_mp3(head: bytes, size: int) -> dict:
    at = 0
    if head[:3] == b"ID3" and len(head) >= 10:
        tag = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]
        at = 10 + tag
    meta: dict = {"id3v2Bytes": at}
    limit = min(len(head) - 4, at + 4096)
    while at <= limit:
        if head[at] == 0xFF and head[at + 1] & 0xE0 == 0xE0:
            version = (head[at + 1] >> 3) & 0x03
            layer = (head[at + 1] >> 1) & 0x03
            bitrate_index = head[at + 2] >> 4
            rate_index = (head[at + 2] >> 2) & 0x03
            if version != 1 and layer == 1 and rate_index != 3 and 0 < bitrate_index < 15:
                bitrate = _MP3_BITRATES[3 if version == 3 else 2][bitrate_index]
                channels = 1 if head[at + 3] >> 6 == 3 else 2
                meta.update(
                    {
                        "mpegVersion": {3: "1", 2: "2", 0: "2.5"}[version],
                        "layer": 3,
                        "bitrateKbps": bitrate,
                        "sampleRate": _MP3_RATES[version][rate_index],
                        "channels": channels,
                        # Exact for constant bit rate; an estimate for variable bit rate.
                        "estimatedDurationSeconds": round((size - at) * 8 / (bitrate * 1000), 2),
                        "problems": [],
                    }
                )
                return meta
        at += 1
    return {**meta, "problems": ["mp3_frame_not_found"]}


def probe(file_format: str, read: Reader, size: int) -> dict:
    """Metadata for one stored file. `file_format` is an asset library format name."""
    if size <= 0:
        return {"problems": ["empty"]}
    if file_format == "glb":
        return probe_glb(read, size)
    if file_format == "gltf":
        return probe_gltf(read, size)
    head = read(0, min(size, HEAD_BYTES))
    simple = {"png": probe_png, "jpeg": probe_jpeg, "webp": probe_webp, "ogg": probe_ogg}
    if file_format in simple:
        return {"byteLength": size, **simple[file_format](head)}
    if file_format == "wav":
        return {"byteLength": size, **probe_wav(head, size)}
    if file_format == "mp3":
        return {"byteLength": size, **probe_mp3(head, size)}
    return {"byteLength": size, "problems": ["format_not_probed"]}
