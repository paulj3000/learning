"""The Django-free jobs core: envelope validation and the asset probes (no database)."""

import json
import struct
import uuid

import pytest

from apps.jobs.core import envelope, probe, tasks

from .helpers import tiny_glb

JOB = str(uuid.uuid4())


def good_result(**overrides):
    data = envelope.build_result(JOB, "asset.inspect", "succeeded", result={"a": 1})
    data.update(overrides)
    return data


def test_round_trip_and_strictness():
    assert envelope.parse_result(envelope.encode(good_result()))["result"] == {"a": 1}
    for broken in (
        {**good_result(), "extra": 1},
        good_result(schema=2),
        good_result(job_id="not-a-uuid"),
        good_result(kind="shell.exec"),
        good_result(status="done"),
        good_result(result=None),  # succeeded needs a result or a pointer
        good_result(error={"code": "x", "retryable": False}),  # error only when failed
        good_result(result_s3_key="jobs/results/other.json", result=None),
        good_result(worker={"function": "f"}),
        good_result(finished_at="yesterday"),
    ):
        with pytest.raises(envelope.EnvelopeError):
            envelope.parse_result(broken)


def test_failed_needs_a_safe_code():
    failed = envelope.build_result(JOB, "asset.inspect", "failed", error_code="object_missing")
    assert failed["error"] == {"code": "object_missing", "retryable": False}
    with pytest.raises(envelope.EnvelopeError):
        envelope.parse_result({**failed, "error": {"code": "Bad Code!", "retryable": False}})
    with pytest.raises(envelope.EnvelopeError):
        envelope.parse_result({**failed, "error": None})


def test_running_carries_no_result():
    running = envelope.build_result(JOB, "asset.inspect", "running")
    with pytest.raises(envelope.EnvelopeError):
        envelope.parse_result({**running, "result": {"x": 1}})


def test_error_messages_name_fields_not_values():
    with pytest.raises(envelope.EnvelopeError) as raised:
        envelope.parse_result(good_result(job_id="secret-text-here"))
    assert "secret" not in str(raised.value)


def test_work_envelopes_are_checked_against_the_queue():
    work = envelope.build_work(JOB, "studio.generate_chunk", {"x": 1})
    assert envelope.parse_work(json.dumps(work))["kind"] == "studio.generate_chunk"
    with pytest.raises(envelope.EnvelopeError, match="queue"):
        envelope.parse_work(work, allowed_kinds=envelope.kinds_for_queue("media"))
    assert envelope.kinds_for_queue("media") == {"speech.synthesize", "asset.inspect"}


def test_large_results_become_pointers():
    small = good_result()
    assert envelope.for_message(small) is small
    big = good_result(result={"blob": "x" * (envelope.INLINE_RESULT_LIMIT + 1)})
    message = envelope.for_message(big)
    assert message["result"] is None and message["result_s3_key"] == f"jobs/results/{JOB}.json"
    assert envelope.parse_result(message)


# --- probes ---------------------------------------------------------------------------------------


def reader(data: bytes):
    return lambda start, length: data[start : start + length]


def test_glb_probe_reads_counts_and_extensions():
    data = tiny_glb()
    meta = probe.probe("glb", reader(data), len(data))
    assert meta["glbVersion"] == 2 and meta["byteLength"] == len(data)
    assert meta["counts"]["nodes"] == 3 and meta["counts"]["materials"] == 2
    assert meta["counts"]["animations"] == 1 and meta["counts"]["skins"] == 0
    assert meta["extensionsRequired"] == ["KHR_draco_mesh_compression"]
    assert meta["bufferSizes"] == [4] and meta["binChunkLength"] == 4
    assert meta["problems"] == []


def test_glb_probe_reports_problems_without_raising():
    data = tiny_glb()
    assert probe.probe("glb", reader(b"nope" + data[4:]), len(data))["problems"] == ["not_glb"]
    truncated = data[:-2]
    assert "length_mismatch" in probe.probe("glb", reader(truncated), len(truncated))["problems"]
    broken = data[:20] + b"!" + data[21:]
    assert "json_invalid" in probe.probe("glb", reader(broken), len(broken))["problems"]


def test_image_and_audio_probes():
    png = (
        b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">IIBB", 64, 32, 8, 6)
    )
    assert probe.probe("png", reader(png + b"\x00" * 10), len(png) + 10)["width"] == 64
    jpeg = (
        b"\xff\xd8\xff\xe0"
        + struct.pack(">H", 4)
        + b"JF"
        + b"\xff\xc0"
        + struct.pack(">HBHHB", 11, 8, 48, 96, 3)
        + b"\x00" * 6
    )
    meta = probe.probe("jpeg", reader(jpeg), len(jpeg))
    assert (meta["width"], meta["height"]) == (96, 48)
    webp = b"RIFF" + struct.pack("<I", 30) + b"WEBPVP8L" + struct.pack("<I", 10) + b"\x2f"
    webp += ((99) | (49 << 14)).to_bytes(4, "little") + b"\x00" * 8
    meta = probe.probe("webp", reader(webp), len(webp))
    assert (meta["width"], meta["height"]) == (100, 50)
    fmt = struct.pack("<HHIIHH", 1, 1, 8000, 16000, 2, 16)
    wav = b"RIFF" + struct.pack("<I", 0) + b"WAVE" + b"fmt " + struct.pack("<I", 16) + fmt
    wav += b"data" + struct.pack("<I", 32000)
    meta = probe.probe("wav", reader(wav), len(wav) + 32000)
    assert meta["sampleRate"] == 8000 and meta["durationSeconds"] == 2.0
    ogg = b"OggS" + b"\x00" * 22 + b"\x01" + b"\x1e" + b"\x01vorbis" + struct.pack("<I", 0)
    ogg += bytes([2]) + struct.pack("<I", 44100) + b"\x00" * 16
    assert probe.probe("ogg", reader(ogg), len(ogg))["codec"] == "vorbis"
    mp3 = b"\xff\xfb\x90\x64" + b"\x00" * 400
    meta = probe.probe("mp3", reader(mp3), len(mp3))
    assert meta["bitrateKbps"] == 128 and meta["sampleRate"] == 44100


def test_core_imports_nothing_from_django():
    import ast
    from pathlib import Path

    for path in Path(tasks.__file__).parent.glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.level == 0:
                assert not (node.module or "").startswith(("django", "apps")), path.name
            if isinstance(node, ast.Import):
                assert not any(a.name.startswith(("django", "apps")) for a in node.names)
