"""The audio inspector (LAI-LAMBDA-008 phase 1): WAV, MP3 and Ogg header facts and findings,
bounds, the declared-type check, and the processor through the registry and the engine.

Every file is synthesised by tests/processing/audio_builder.py; no binary fixtures."""

from __future__ import annotations

import hashlib
import io
import struct
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import audio_builder as b
import pytest

from lai_processing.contracts import (
    AssetContext,
    InputObject,
    ObjectRef,
    ProcessingJobRequest,
    ProfileRef,
    ResultStatus,
    StoreName,
    SubjectRef,
    Verdict,
    decode_result,
    encode,
)
from lai_processing.core.canonical import canonical_json
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.core.execution import ExecutionEngine
from lai_processing.core.idempotency import request_idempotency_key
from lai_processing.core.limits import PLATFORM_CEILINGS
from lai_processing.core.registry import default_registry
from lai_processing.processors.audio import (
    AUDIO_PROFILE,
    AudioInspectorProcessor,
    AudioSettings,
    inspect_audio,
    sniff,
)
from lai_processing.processors.audio.processor import MAX_AUDIO_INPUT_BYTES
from lai_processing.processors.audio.report import Report
from lai_processing.testing import ManualClock, MemoryObjectStorage, RecordingTelemetry

METADATA_KEYS = {
    "metadata_version",
    "detected_format",
    "container",
    "codec",
    "file_size_bytes",
    "declared_content_type",
    "declared_format",
    "declared_type_matches",
    "duration_seconds",
    "duration_kind",
    "sample_rate_hz",
    "channels",
    "sample_width_bits",
    "bitrate_bps",
    "bitrate_mode",
    "scan",
    "structure",
    "limitations",
}
BASE_LIMITATIONS = ["header_only", "playback_not_verified", "loudness_not_measured"]


def inspect(data: bytes, content_type: str = "", settings: AudioSettings | None = None):
    if not content_type:
        content_type = {"wav": "audio/wav", "mp3": "audio/mpeg", "ogg": "audio/ogg"}.get(
            sniff(data[:16]) or "", "audio/mpeg"
        )
    inspection = inspect_audio(
        io.BytesIO(data), len(data), content_type, settings or AudioSettings()
    )
    metadata = inspection.metadata
    assert set(metadata) == METADATA_KEYS
    canonical_json(metadata)  # plain, finite JSON
    codes = {f.code: f.severity.value for f in inspection.report.findings()}
    return metadata, codes, inspection.report


def limitation_codes(metadata) -> list[str]:
    return [item["code"] for item in metadata["limitations"]]


# --- WAV -------------------------------------------------------------------------------------


def test_a_valid_pcm_wav_reports_exact_facts():
    metadata, codes, report = inspect(b.wav(seconds=1.5, rate=22050, channels=2, bits=16))
    assert codes == {} and not report.has_errors
    assert metadata["detected_format"] == "wav" and metadata["container"] == "riff_wave"
    assert metadata["codec"] == "pcm"
    assert metadata["duration_seconds"] == 1.5 and metadata["duration_kind"] == "exact"
    assert metadata["sample_rate_hz"] == 22050 and metadata["channels"] == 2
    assert metadata["sample_width_bits"] == 16
    assert metadata["bitrate_bps"] == 22050 * 2 * 16 and metadata["bitrate_mode"] == "constant"
    assert metadata["structure"]["chunks"] == ["fmt ", "data"]
    assert metadata["structure"]["sample_frames"] == 33075
    assert metadata["scan"] == {"unit": "chunk", "units_scanned": 2, "complete": True}
    assert metadata["declared_type_matches"] is True
    assert limitation_codes(metadata) == BASE_LIMITATIONS


def test_float_and_extensible_pcm_wav_are_recognised():
    metadata, codes, _ = inspect(b.wav(rate=48000, channels=2, bits=32, tag=3))
    assert codes == {} and metadata["codec"] == "float"
    guid_tail = b"\x00\x00\x00\x00\x10\x00\x80\x00\x00\xaa\x00\x38\x9b\x71"
    ext = struct.pack("<HHIIHHHHI", 0xFFFE, 2, 44100, 44100 * 4, 4, 16, 22, 16, 3)
    ext += struct.pack("<H", 1) + guid_tail
    metadata, codes, _ = inspect(b.wav(rate=44100, channels=2, fmt_override=ext))
    assert codes == {} and metadata["codec"] == "pcm"
    assert metadata["structure"]["format_tag"] == 0xFFFE
    assert metadata["structure"]["subformat_tag"] == 1


def test_an_unsupported_wav_codec_is_reported_with_a_fact_chunk_duration():
    mulaw = struct.pack("<HHIIHH", 7, 1, 8000, 8000, 1, 8)
    data = b.wav(
        seconds=1, bits=8, fmt_override=mulaw, extra_chunks=((b"fact", struct.pack("<I", 8000)),)
    )
    metadata, codes, _ = inspect(data)
    assert codes["wav_codec_unsupported"] == "error"
    assert metadata["codec"] == "mulaw"
    assert metadata["duration_seconds"] == 1.0 and metadata["duration_kind"] == "exact"


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"RIFF" + struct.pack("<I", 4) + b"WAVE", "wav_fmt_missing"),
        (
            b"RIFF" + struct.pack("<I", 14) + b"WAVE" + b.chunk(b"fmt ", b"\x01\x00"),
            "wav_fmt_invalid",
        ),
        (b.wav(channels=0, bits=16), "wav_no_channels"),
        (b.wav(bits=12), "wav_bits_unsupported"),
        (
            b.wav(fmt_override=struct.pack("<HHIIHH", 1, 1, 8000, 16000, 4, 16)),
            "wav_block_align_mismatch",
        ),
        (
            b"RIF" + b"F" + struct.pack("<I", 12) + b"WAVE" + b"\x01\x02\x03\x04" + b"\x00" * 4,
            "wav_chunk_id_invalid",
        ),
        (
            b"RIFF" + struct.pack("<I", 12) + b"WAVE" + b"LIST" + struct.pack("<I", 999),
            "wav_chunk_overruns",
        ),
        (b"RF64" + struct.pack("<I", 0xFFFFFFFF) + b"WAVE", "wav_rf64_unsupported"),
        (b"RIFX" + struct.pack(">I", 4) + b"WAVE", "wav_big_endian_unsupported"),
        (b.wav() + b"extra bytes", "trailing_data"),
    ],
)
def test_malformed_wav_files_are_errors(data, code):
    metadata, codes, report = inspect(data, "audio/wav")
    assert codes.get(code) == "error", codes
    assert report.has_errors and metadata["detected_format"] == "wav"


def test_a_duplicate_data_chunk_is_an_error():
    data = b.wav(extra_chunks=((b"data", b"\x00\x00"),))
    _, codes, _ = inspect(data)
    assert codes["wav_duplicate_data"] == "error"


def test_a_truncated_wav_is_an_error_with_an_estimated_duration():
    data = b.wav(seconds=2)[:-8000]
    metadata, codes, _ = inspect(data)
    assert codes["wav_truncated"] == "error" and codes["wav_data_truncated"] == "error"
    assert metadata["duration_kind"] == "estimated"
    assert metadata["duration_seconds"] == pytest.approx(1.5)


def test_a_streamed_wav_without_a_data_length_is_reported():
    data = b.wav(data_length=0xFFFFFFFF)
    metadata, codes, _ = inspect(data)
    assert codes["wav_data_truncated"] == "error"
    assert metadata["structure"]["data_chunk_bytes"] == 0xFFFFFFFF


def test_odd_chunks_use_their_pad_byte():
    data = b.wav(extra_chunks=((b"note", b"abc"),))  # odd-length chunk, padded
    metadata, codes, _ = inspect(data)
    assert codes == {} and metadata["structure"]["chunks"] == ["fmt ", "note", "data"]


def test_an_odd_last_chunk_without_its_pad_byte_is_a_warning():
    body = b"WAVE" + b.chunk(b"fmt ", struct.pack("<HHIIHH", 1, 1, 8000, 8000, 1, 8))
    body += b"data" + struct.pack("<I", 8001) + b"\x00" * 8001
    data = b"RIFF" + struct.pack("<I", len(body)) + body
    metadata, codes, _ = inspect(data)
    assert codes == {"wav_missing_pad_byte": "warning"}
    assert metadata["duration_kind"] == "exact"


def test_the_chunk_walk_is_bounded():
    extras = tuple((b"junk", b"\x00\x00") for _ in range(10))
    metadata, codes, _ = inspect(
        b.wav(extra_chunks=extras), settings=AudioSettings(max_wav_chunks=4)
    )
    assert codes["wav_too_many_chunks"] == "error"
    assert metadata["scan"]["units_scanned"] == 4 and metadata["scan"]["complete"] is False


def test_a_wav_with_more_than_two_channels_breaks_the_upload_policy_only_as_a_warning():
    metadata, codes, report = inspect(b.wav(seconds=0.1, channels=6))
    assert codes == {"channels_outside_upload_policy": "warning"} and not report.has_errors
    assert metadata["channels"] == 6


# --- MP3 -------------------------------------------------------------------------------------

FRAME_SECONDS = 1152 / 44100


def test_a_cbr_mp3_has_an_estimated_duration_and_a_limitation():
    metadata, codes, report = inspect(b.mp3_cbr(frames=40))
    assert codes == {} and not report.has_errors
    assert metadata["codec"] == "mp3" and metadata["container"] == "mpeg_audio"
    assert metadata["bitrate_mode"] == "constant" and metadata["bitrate_bps"] == 128000
    assert metadata["sample_rate_hz"] == 44100 and metadata["channels"] == 2
    assert metadata["sample_width_bits"] is None
    assert metadata["duration_kind"] == "estimated"
    assert metadata["duration_seconds"] == pytest.approx(40 * FRAME_SECONDS, abs=1e-6)
    structure = metadata["structure"]
    assert structure["id3v2_bytes"] == 30 and structure["mpeg_version"] == "1"
    assert structure["layer"] == 3 and structure["vbr_header"] is None
    assert "mp3_cbr_estimate" in limitation_codes(metadata)
    assert "mp3_encoder_delay" in limitation_codes(metadata)


def test_a_vbr_mp3_with_a_xing_header_has_an_exact_duration():
    metadata, codes, _ = inspect(b.mp3_vbr_xing())
    assert codes == {}
    assert metadata["bitrate_mode"] == "variable"
    assert metadata["duration_kind"] == "exact"
    assert metadata["duration_seconds"] == pytest.approx(40 * FRAME_SECONDS, abs=1e-6)
    assert metadata["structure"]["vbr_header"] == "xing"
    assert metadata["structure"]["vbr_header_frames"] == 40
    assert metadata["structure"]["audio_frames_scanned"] == 40
    assert metadata["structure"]["distinct_bitrates"] == 4


def test_a_vbr_mp3_without_a_header_is_estimated_with_a_warning_and_a_limitation():
    metadata, codes, report = inspect(b.mp3_vbr_without_header())
    assert codes == {"mp3_vbr_without_header": "warning"} and not report.has_errors
    assert metadata["bitrate_mode"] == "variable" and metadata["duration_kind"] == "estimated"
    assert metadata["duration_seconds"] == pytest.approx(40 * FRAME_SECONDS, abs=1e-6)
    assert "mp3_vbr_estimate" in limitation_codes(metadata)


def test_an_info_header_marks_a_constant_bit_rate_with_an_exact_duration():
    frames = b.mp3_frame() * 20
    data = b.xing_frame(20, len(frames), tag=b"Info") + frames
    metadata, codes, _ = inspect(data)
    assert codes == {} and metadata["bitrate_mode"] == "constant"
    assert metadata["duration_kind"] == "exact" and metadata["bitrate_bps"] == 128000


def test_a_vbri_header_is_read():
    first = bytearray(b.mp3_frame())
    first[36:54] = b"VBRI" + struct.pack(">HHHII", 1, 0, 75, 9999, 30)
    data = bytes(first) + b"".join(b.mp3_frame(k) for k in (128, 64, 192) * 10)
    metadata, codes, _ = inspect(data)
    assert metadata["structure"]["vbr_header"] == "vbri"
    assert metadata["duration_kind"] == "exact"
    assert metadata["duration_seconds"] == pytest.approx(30 * FRAME_SECONDS, abs=1e-6)
    assert "mp3_frame_count_mismatch" not in codes


def test_a_xing_count_that_disagrees_with_the_frames_is_a_warning():
    frames = b.mp3_frame() * 10
    data = b.xing_frame(500, len(frames)) + frames
    _, codes, _ = inspect(data)
    assert codes == {"mp3_frame_count_mismatch": "warning"}


def test_trailing_tags_are_skipped_and_trailing_garbage_is_an_error():
    tagged = b.mp3_cbr(frames=5) + b"TAG" + b"\x00" * 125
    metadata, codes, _ = inspect(tagged)
    assert codes == {} and metadata["structure"]["trailing_tags"] == ["id3v1"]
    _, codes, _ = inspect(b.mp3_cbr(frames=5) + b"this is not audio" * 3)
    assert codes["trailing_data"] == "error"
    _, codes, _ = inspect(b.mp3_cbr(frames=5) + b"\x00" * 50)
    assert codes == {"mp3_trailing_padding": "warning"}


def test_a_truncated_last_frame_is_a_warning():
    metadata, codes, _ = inspect(b.mp3_cbr(frames=5)[:-100])
    assert codes == {"mp3_last_frame_truncated": "warning"}
    assert metadata["structure"]["frames_scanned"] == 4


def test_leading_junk_before_the_first_frame_is_a_warning():
    data = b.id3v2() + b"\x00\x01\x02" * 10 + b.mp3_frame() * 5
    _, codes, _ = inspect(data)
    assert codes == {"mp3_leading_junk": "warning"}


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"ID3\x03\x00\x00\x00\x00\x80\x00" + b.mp3_frame() * 3, "mp3_id3_invalid"),
        (b"ID3\x09\x00\x00\x00\x00\x00\x10" + b.mp3_frame() * 3, "mp3_id3_invalid"),
        (b.id3v2(payload_bytes=5000)[:200], "mp3_id3_truncated"),
        (b.id3v2() + b"this is not an mp3 at all" * 20, "mp3_no_frames"),
        (b.mp3_frame() * 3 + b.mp3_frame(rate_index=1) * 3, "mp3_stream_changes"),
        (b"\xff\xfb\x00\x00" + b"\x00" * 400, "mp3_free_format_unsupported"),
        (b"\xff\xfd\x90\x00" + b"\x00" * 400, "mp3_layer_unsupported"),
    ],
)
def test_malformed_mp3_files_are_errors(data, code):
    _, codes, report = inspect(data, "audio/mpeg")
    assert codes.get(code) == "error", codes
    assert report.has_errors


def test_id3_tags_beyond_the_size_bound_are_refused():
    data = b.id3v2(payload_bytes=4096) + b.mp3_frame() * 3
    _, codes, _ = inspect(data, settings=AudioSettings(max_id3_bytes=1024))
    assert codes["mp3_id3_too_large"] == "error"


def test_the_frame_walk_is_bounded_and_then_estimates():
    metadata, codes, report = inspect(
        b.mp3_cbr(frames=40), settings=AudioSettings(max_mp3_frames=5)
    )
    assert codes == {}
    assert [w.code for w in report.warnings()] == ["mp3_scan_limit"]
    assert metadata["scan"] == {"unit": "frame", "units_scanned": 5, "complete": False}
    assert metadata["duration_kind"] == "estimated"
    assert metadata["duration_seconds"] == pytest.approx(40 * FRAME_SECONDS, rel=0.01)


def test_a_very_long_declared_duration_breaks_the_upload_policy_as_a_warning():
    frames = b.mp3_frame() * 3
    data = b.xing_frame(40000, len(frames)) + frames
    metadata, codes, _ = inspect(data)
    assert codes["duration_outside_upload_policy"] == "warning"
    assert metadata["duration_seconds"] > 900


# --- Ogg -------------------------------------------------------------------------------------


def test_ogg_vorbis_reports_exact_facts():
    metadata, codes, report = inspect(b.ogg_vorbis(seconds=2.5, rate=32000, channels=1))
    assert codes == {} and not report.has_errors
    assert metadata["container"] == "ogg" and metadata["codec"] == "vorbis"
    assert metadata["sample_rate_hz"] == 32000 and metadata["channels"] == 1
    assert metadata["duration_seconds"] == 2.5 and metadata["duration_kind"] == "exact"
    structure = metadata["structure"]
    assert structure["stream_count"] == 1 and structure["multiplexed"] is False
    assert structure["chained_links"] == 1
    assert structure["streams"][0]["nominal_bitrate_bps"] == 128000
    assert structure["crc_pages_checked"] == 5
    assert "ogg_crc_sampled" in limitation_codes(metadata)


def test_ogg_opus_subtracts_the_pre_skip_at_48_khz():
    metadata, codes, _ = inspect(b.ogg_opus(seconds=1.25, channels=1, pre_skip=3840))
    assert codes == {}
    assert metadata["codec"] == "opus" and metadata["sample_rate_hz"] == 48000
    assert metadata["duration_seconds"] == 1.25 and metadata["duration_kind"] == "exact"
    stream = metadata["structure"]["streams"][0]
    assert stream["pre_skip"] == 3840 and stream["input_sample_rate_hz"] == 48000


@pytest.mark.parametrize(
    "ident",
    [b.flac_in_ogg_id(), b"Speex   1.2" + b"\x00" * 69, b"\x80theora" + b"\x00" * 34],
)
def test_unsupported_codecs_in_ogg_are_errors(ident):
    data = b"".join(b.ogg_stream(ident, 1000))
    metadata, codes, report = inspect(data)
    assert codes["ogg_codec_unsupported"] == "error" and report.has_errors
    assert metadata["codec"] in {"flac", "speex", "theora"}
    assert metadata["duration_seconds"] is None and metadata["duration_kind"] == "unavailable"


def test_a_broken_capture_pattern_is_an_error():
    pages = b.ogg_stream(b.vorbis_id(), 44100)
    pages[2] = b"OggX" + pages[2][4:]
    _, codes, _ = inspect(b"".join(pages))
    assert codes["ogg_capture_pattern"] == "error"


def test_a_bad_page_checksum_is_an_error():
    pages = b.ogg_stream(b.vorbis_id(), 44100)
    pages[1] = b.ogg_page(b"\x03comment" + b"\x00" * 8, sequence=1, good_crc=False)
    _, codes, _ = inspect(b"".join(pages))
    assert codes == {"ogg_crc_mismatch": "error"}


def test_the_last_page_checksum_is_always_verified():
    pages = b.ogg_stream(b.vorbis_id(), 44100, data_pages=6)
    last = pages[-1]
    pages[-1] = last[:22] + bytes([last[22] ^ 0xFF]) + last[23:]
    metadata, codes, _ = inspect(
        b"".join(pages), settings=replace(AudioSettings(), ogg_crc_pages=2)
    )
    assert codes == {"ogg_crc_mismatch": "error"}
    assert metadata["structure"]["crc_pages_checked"] == 3


def test_a_truncated_ogg_file_is_an_error():
    _, codes, _ = inspect(b.ogg_vorbis()[:-20])
    assert codes["ogg_truncated"] == "error"


def test_an_ogg_stream_without_its_last_page_is_an_error():
    _, codes, _ = inspect(b.ogg_vorbis(end=False))
    assert codes["ogg_no_end_of_stream"] == "error"


def test_multiplexed_streams_are_an_error():
    first = b.ogg_stream(b.vorbis_id(), 44100, serial=1)
    second = b.ogg_stream(b.opus_head(), 48312, serial=2)
    pairs = zip(first[1:], second[1:], strict=True)
    interleaved = [first[0], second[0], *[page for pair in pairs for page in pair]]
    metadata, codes, _ = inspect(b"".join(interleaved))
    assert codes["ogg_multiplexed"] == "error"
    assert (
        metadata["structure"]["multiplexed"] is True and metadata["structure"]["stream_count"] == 2
    )


def test_chained_streams_are_a_warning_and_their_durations_add_up():
    data = b.ogg_vorbis(seconds=1.0, serial=1) + b.ogg_opus(seconds=2.0, serial=2)
    metadata, codes, report = inspect(data)
    assert codes == {"ogg_chained": "warning"} and not report.has_errors
    assert metadata["duration_seconds"] == 3.0 and metadata["duration_kind"] == "exact"
    assert metadata["structure"]["chained_links"] == 2
    assert [s["link"] for s in metadata["structure"]["streams"]] == [0, 1]
    assert "ogg_chained" in limitation_codes(metadata)


def test_a_page_sequence_gap_is_a_warning():
    pages = b.ogg_stream(b.vorbis_id(), 44100, data_pages=4)
    del pages[3]
    _, codes, _ = inspect(b"".join(pages))
    assert codes == {"ogg_page_sequence_gap": "warning"}


def test_a_page_of_an_unknown_stream_is_an_error():
    pages = b.ogg_stream(b.vorbis_id(), 44100)
    pages.insert(2, b.ogg_page(b"\x00" * 10, serial=77, sequence=0))
    _, codes, _ = inspect(b"".join(pages))
    assert codes["ogg_page_without_stream"] == "error"


def test_an_opus_stream_ending_before_its_pre_skip_is_an_error():
    data = b"".join(b.ogg_stream(b.opus_head(pre_skip=3840), 100))
    _, codes, _ = inspect(data)
    assert codes["ogg_granule_before_preskip"] == "error"


def test_an_opus_header_with_more_than_two_channels_and_no_mapping_is_an_error():
    data = b"".join(b.ogg_stream(b.opus_head(channels=6), 48000))
    _, codes, _ = inspect(data)
    assert codes["ogg_opus_header_invalid"] == "error"


def test_the_page_walk_is_bounded_and_estimates_from_the_last_page():
    data = b.ogg_vorbis(seconds=3.0, data_pages=20)
    metadata, codes, report = inspect(data, settings=AudioSettings(max_ogg_pages=4))
    assert codes == {}
    assert [w.code for w in report.warnings()] == ["ogg_scan_limit"]
    assert metadata["scan"] == {"unit": "page", "units_scanned": 4, "complete": False}
    assert metadata["duration_seconds"] == 3.0 and metadata["duration_kind"] == "estimated"


def test_bytes_after_the_ogg_stream_are_an_error():
    _, codes, _ = inspect(b.ogg_vorbis() + b"trailing garbage bytes here")
    assert codes["ogg_capture_pattern"] == "error"


def test_the_crc_matches_the_independent_implementation():
    from lai_processing.processors.audio.ogg import ogg_crc

    for sample in (b"", b"OggS", bytes(range(256)) * 3):
        assert ogg_crc(sample) == b.ogg_crc(sample)


# --- detection, declared type, determinism -----------------------------------------------------


def test_the_format_comes_from_the_bytes_and_a_wrong_declared_type_is_an_error():
    metadata, codes, _ = inspect(b.wav(), "audio/mpeg")
    assert metadata["detected_format"] == "wav" and metadata["declared_format"] == "mp3"
    assert metadata["declared_type_matches"] is False
    assert codes == {"declared_type_mismatch": "error"}


def test_an_invalid_declared_type_is_reported():
    metadata, codes, _ = inspect(b.ogg_vorbis(), "image/png")
    assert codes == {"declared_type_not_audio": "error"}
    assert metadata["declared_format"] is None and metadata["declared_type_matches"] is None
    _, codes, report = inspect(b.ogg_vorbis(), "audio/aac")
    assert codes == {"declared_type_unrecognized": "warning"} and not report.has_errors


@pytest.mark.parametrize(
    ("data", "code", "container"),
    [
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 40, "not_audio", None),
        (b"fLaC\x00\x00\x00\x22" + b"\x00" * 40, "audio_format_unsupported", "flac"),
        (b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 40, "audio_format_unsupported", "mp4"),
        (b"", "empty_file", None),
    ],
)
def test_files_that_are_not_supported_audio_fail(data, code, container):
    metadata, codes, report = inspect(data, "audio/mpeg")
    assert codes.get(code) == "error" and report.has_errors
    assert metadata["detected_format"] is None and metadata["container"] == container
    assert metadata["duration_kind"] == "unavailable"
    assert limitation_codes(metadata) == BASE_LIMITATIONS


def test_the_metadata_is_deterministic():
    for data in (b.wav(), b.mp3_vbr_xing(), b.ogg_opus()):
        first, _, _ = inspect(data)
        second, _, _ = inspect(data)
        assert canonical_json(first) == canonical_json(second)


def test_findings_are_bounded_and_truncation_never_hides_an_error():
    report = Report(max_findings=3)
    for index in range(5):
        report.warn("w", "A warning.", f"x[{index}]")
    report.error("e", "An error.", "y")
    findings = report.findings()
    assert len(findings) == 4 and findings[-1].code == "too_many_findings"
    assert findings[-1].severity.value == "error" and report.has_errors


# --- the processor through the registry and the engine -------------------------------------

NS = "test"
JOB_ID = "11111111-1111-4111-8111-111111111111"
VERSION_ID = "33333333-3333-4333-8333-333333333333"
KEY = "assets/audio/coin-clink/33333333-3333-4333-8333-333333333333/audio.wav"


def make_request(data: bytes, content_type: str = "audio/wav", limits=AUDIO_PROFILE.limits):
    request = ProcessingJobRequest(
        job_id=JOB_ID,
        job_type="asset.process_audio",
        namespace=NS,
        subject=SubjectRef("asset_version", VERSION_ID),
        asset=AssetContext("coin-clink", VERSION_ID, 1),
        profile=ProfileRef("audio-inspect", 1),
        idempotency_key="ik1:" + "c" * 64,
        correlation_id="corr-audio-0001",
        attempt_id="22222222-2222-4222-8222-222222222222",
        attempt_number=1,
        submitted_at=datetime(2026, 11, 17, 11, 0, tzinfo=UTC),
        input=InputObject(
            ref=ObjectRef(StoreName.ASSETS, KEY, None, NS),
            content_type=content_type,
            size_bytes=len(data),
            sha256=hashlib.sha256(data).hexdigest(),
        ),
        options={},
        limits=limits,
    )
    return replace(request, idempotency_key=request_idempotency_key(request))


def run(tmp_path: Path, data: bytes, content_type="audio/wav", *, ceilings=PLATFORM_CEILINGS):
    storage = MemoryObjectStorage()
    storage.seed(ObjectRef(StoreName.ASSETS, KEY, None, NS), data)
    engine = ExecutionEngine(
        registry=default_registry(),
        storage=storage,
        telemetry=RecordingTelemetry(),
        clock=ManualClock(),
        ceilings=ceilings,
        workspace_root=tmp_path,
        id_factory=lambda: "44444444-4444-4444-8444-444444444444",
    )
    result = engine.execute(make_request(data, content_type))
    assert decode_result(encode(result)) == result
    return result


def test_registered_with_its_profile():
    processor, profile = default_registry().resolve(
        "asset.process_audio", ProfileRef("audio-inspect", 1)
    )
    assert isinstance(processor, AudioInspectorProcessor) and profile is AUDIO_PROFILE
    assert processor.identity.processor_id == "asset.audio_inspector"
    assert processor.version == "1.0.0"
    assert profile.limits.max_input_bytes == MAX_AUDIO_INPUT_BYTES == 20 * 1024 * 1024
    assert dict(profile.resolve_options({})) == {}


def test_a_valid_file_succeeds_with_verdict_pass(tmp_path):
    result = run(tmp_path, b.wav())
    assert result.status is ResultStatus.SUCCEEDED and result.verdict is Verdict.PASS
    assert result.metadata["codec"] == "pcm" and result.input.verified
    assert result.artifacts == ()


def test_a_malformed_file_succeeds_with_verdict_fail(tmp_path):
    result = run(tmp_path, b.wav()[:-100])
    assert result.status is ResultStatus.SUCCEEDED and result.verdict is Verdict.FAIL
    assert "wav_truncated" in {f.code for f in result.findings}


def test_a_declared_type_mismatch_fails_the_verdict(tmp_path):
    result = run(tmp_path, b.ogg_opus(), "audio/mpeg")
    assert result.verdict is Verdict.FAIL
    assert result.metadata["detected_format"] == "ogg"


def test_an_oversized_input_is_refused_before_and_during_processing(tmp_path):
    data = b.wav(seconds=1)
    small = replace(AUDIO_PROFILE.limits, max_input_bytes=len(data) - 1)
    with pytest.raises(ProcessingError) as raised:
        make_request(data, limits=small)
    assert raised.value.code is ErrorCode.RESOURCE_LIMIT_EXCEEDED
    ceilings = replace(PLATFORM_CEILINGS, max_input_bytes=len(data) - 1)
    result = run(tmp_path, data, ceilings=ceilings)
    assert result.status is ResultStatus.FAILED
    assert result.errors[0].code is ErrorCode.RESOURCE_LIMIT_EXCEEDED
