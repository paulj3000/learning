"""Embedded image metadata scanner (LAI-LAMBDA-013): presence only, bounded, never raises."""

from __future__ import annotations

import random

import pytest
from image_builder import (
    jpeg,
    jpeg_app1_exif,
    jpeg_app1_xmp,
    jpeg_app2_icc,
    jpeg_comment,
    jpeg_iptc,
    png,
    png_itxt_xmp,
    tiff_exif,
    tiff_tags,
    webp,
)

from lai_processing.processors.image import metadata as m
from lai_processing.processors.image import scan_image_metadata_bytes as scan

GPS_XMP = b"<x:xmpmeta><rdf:li exif:GPSLatitude='1'/></x:xmpmeta>"
PLAIN_XMP = b"<x:xmpmeta><dc:title>Tree</dc:title></x:xmpmeta>"


@pytest.mark.parametrize("order", ["<", ">"])
def test_jpeg_exif_with_gps_position_and_orientation(order):
    facts = scan(jpeg(jpeg_app1_exif(tiff_exif(orientation=6, gps="position", order=order))))
    assert facts.format == "jpeg"
    assert facts.exif_present and facts.gps_present and facts.location_present
    assert facts.orientation == 6 and facts.location_possible and not facts.exif_unparsable


def test_jpeg_exif_without_gps_is_not_a_location():
    facts = scan(jpeg(jpeg_app1_exif(tiff_exif(orientation=1))))
    assert facts.exif_present and not facts.gps_present and not facts.location_possible
    assert facts.orientation == 1 and facts.any_metadata


def test_gps_ifd_with_one_tag_counts_as_gps_without_position():
    facts = scan(jpeg(jpeg_app1_exif(tiff_exif(gps="version"))))
    assert facts.gps_present and not facts.location_present and facts.location_possible


def test_bad_gps_pointer_is_reported_present_and_unparsable():
    facts = scan(jpeg(jpeg_app1_exif(tiff_exif(gps="bad"))))
    assert facts.gps_present and facts.exif_unparsable and facts.location_possible


def test_garbage_exif_is_unparsable_and_treated_as_possible_location():
    facts = scan(jpeg(jpeg_app1_exif(b"not a tiff header at all")))
    assert facts.exif_present and facts.exif_unparsable and facts.location_possible


def test_oversized_ifd_count_is_refused_not_read():
    block = b"II*\x00" + (8).to_bytes(4, "little") + (0xFFFF).to_bytes(2, "little") + b"\x00" * 40
    facts = scan(jpeg(jpeg_app1_exif(block)))
    assert facts.exif_unparsable and facts.orientation is None


def test_orientation_out_of_range_is_ignored():
    assert scan(jpeg(jpeg_app1_exif(tiff_exif(orientation=9)))).orientation is None


def test_jpeg_xmp_gps_icc_iptc_comment():
    facts = scan(
        jpeg(
            jpeg_app1_xmp(GPS_XMP),
            jpeg_app2_icc(),
            jpeg_iptc(),
            jpeg_comment(),
        )
    )
    assert facts.xmp_present and facts.location_present and not facts.exif_present
    assert facts.icc_present and facts.iptc_present and facts.text_present


def test_jpeg_plain_xmp_has_no_location():
    facts = scan(jpeg(jpeg_app1_xmp(PLAIN_XMP)))
    assert facts.xmp_present and not facts.location_possible


def test_clean_files_report_nothing():
    for data, fmt in ((jpeg(), "jpeg"), (png(), "png"), (webp(), "webp")):
        facts = scan(data)
        assert facts.format == fmt and not facts.any_metadata and not facts.location_possible
        assert facts.orientation is None and not facts.truncated


def test_png_chunks_before_and_after_idat():
    facts = scan(
        png((b"eXIf", tiff_exif(orientation=3, gps="position")), (b"iCCP", b"sRGB\x00\x00x"))
    )
    assert facts.exif_present and facts.location_present and facts.icc_present
    assert facts.orientation == 3
    late = scan(png(after_idat=((b"eXIf", tiff_exif(gps="position")),)))
    assert late.location_present


def test_png_text_and_itxt_xmp():
    facts = scan(png((b"tEXt", b"Comment\x00hello"), png_itxt_xmp(GPS_XMP)))
    assert facts.text_present and facts.xmp_present and facts.location_present
    plain = scan(png(png_itxt_xmp(PLAIN_XMP)))
    assert plain.xmp_present and not plain.text_present and not plain.location_possible


def test_webp_exif_xmp_icc_chunks():
    exif = scan(webp((b"EXIF", tiff_exif(orientation=8, gps="position"))))
    assert exif.exif_present and exif.location_present and exif.orientation == 8
    prefixed = scan(webp((b"EXIF", b"Exif\x00\x00" + tiff_exif(gps="position"))))
    assert prefixed.location_present
    other = scan(webp((b"XMP ", GPS_XMP), (b"ICCP", b"\x00" * 11)))
    assert other.xmp_present and other.location_present and other.icc_present


def test_truncated_files_set_the_flag_and_do_not_raise():
    data = jpeg(jpeg_app1_exif(tiff_exif(gps="position")))
    assert scan(data[:30]).truncated
    chopped = png((b"eXIf", tiff_exif(gps="position")))[:40]
    assert scan(chopped).truncated
    assert scan(webp((b"EXIF", b"\x00" * 40))[:30]).truncated


def test_unknown_and_empty_input():
    assert scan(b"").format is None and scan(b"GIF89a....").format is None
    assert not scan(b"hello").any_metadata


def test_fuzzed_prefixes_and_mutations_never_raise():
    rng = random.Random(7)  # noqa: S311 - deterministic fuzz
    seeds = [
        jpeg(jpeg_app1_exif(tiff_exif(orientation=6, gps="position")), jpeg_app1_xmp(GPS_XMP)),
        png((b"eXIf", tiff_exif(gps="position")), png_itxt_xmp(GPS_XMP)),
        webp((b"EXIF", tiff_exif(gps="position")), (b"XMP ", GPS_XMP)),
    ]
    for seed in seeds:
        for cut in range(0, len(seed), 3):
            scan(seed[:cut])
        for _ in range(300):
            data = bytearray(seed)
            for _ in range(4):
                data[rng.randrange(len(data))] = rng.randrange(256)
            scan(bytes(data))


def test_result_carries_flags_only_never_values():
    facts = scan(jpeg(jpeg_app1_exif(tiff_exif(orientation=6, gps="position"))))
    flags = facts.as_flags()
    assert set(flags) == {
        "exifPresent", "gpsPresent", "xmpPresent", "iccPresent", "iptcPresent",
        "textPresent", "devicePresent", "ownerPresent", "commentPresent", "thumbnailPresent",
        "orientation", "exifUnparsable",
    }  # fmt: skip
    assert all(isinstance(v, (bool, int, type(None))) for v in flags.values())
    assert flags["gpsPresent"] is True and flags["orientation"] == 6


def test_reads_are_bounded_and_large_exif_is_not_loaded():
    reads: list[int] = []
    data = jpeg(jpeg_app1_exif(b"II*\x00" + b"\x00" * 60000))

    def read(offset, length):
        reads.append(length)
        return data[offset : offset + length]

    m.scan_image_metadata(read, len(data))
    assert max(reads) <= m.MAX_EXIF_BYTES

    big = b"II*\x00" + b"\x00" * (m.MAX_EXIF_BYTES + 10)
    png_data = png((b"eXIf", big))
    reads.clear()

    def read2(offset, length):
        reads.append(length)
        return png_data[offset : offset + length]

    facts = m.scan_image_metadata(read2, len(png_data))
    assert facts.exif_unparsable and max(reads) < m.MAX_EXIF_BYTES


def test_step_limit_stops_a_chunk_flood(monkeypatch):
    monkeypatch.setattr(m, "MAX_STEPS", 50)
    flood = png(*[(b"tEXt", b"")] * 200)
    # tEXt chunks with an empty body: counted as text, then the step limit trips.
    assert scan(flood).truncated


# --- device, owner, comment and thumbnail (Workstream B, image privacy baseline) --------------


@pytest.mark.parametrize("order", ["<", ">"])
@pytest.mark.parametrize(
    ("tiff", "field"),
    [
        (tiff_tags(ifd0=[0x010F, 0x0110]), "device_present"),  # make, model
        (tiff_tags(ifd0=[0x0131]), "device_present"),  # software
        (tiff_tags(exif=[0xA434]), "device_present"),  # lens model
        (tiff_tags(ifd0=[0x013B]), "owner_present"),  # artist
        (tiff_tags(ifd0=[0x8298]), "owner_present"),  # copyright
        (tiff_tags(exif=[0xA430]), "owner_present"),  # camera owner name
        (tiff_tags(ifd0=[0x010E]), "comment_present"),  # image description
        (tiff_tags(exif=[0x9286]), "comment_present"),  # user comment
        (tiff_tags(ifd0=[0x0112], thumbnail=[0x0201, 0x0202]), "thumbnail_present"),
    ],
)
def test_exif_device_owner_comment_and_thumbnail_are_reported(tiff, field, order):
    block = tiff if order == "<" else tiff_tags(order=">")  # big-endian is covered below
    facts = scan(jpeg(jpeg_app1_exif(tiff)))
    assert getattr(facts, field) is True and facts.sensitive_present
    assert facts.exif_present and not facts.exif_unparsable
    assert block  # builder works for both byte orders


def test_big_endian_blocks_are_read_too():
    facts = scan(jpeg(jpeg_app1_exif(tiff_tags(ifd0=[0x010F], thumbnail=[0x0201], order=">"))))
    assert facts.device_present and facts.thumbnail_present


def test_a_plain_orientation_only_exif_is_not_sensitive():
    facts = scan(jpeg(jpeg_app1_exif(tiff_exif(orientation=6))))
    assert facts.exif_present and facts.orientation == 6
    assert not (facts.device_present or facts.owner_present or facts.comment_present)
    assert not facts.thumbnail_present and not facts.sensitive_present


def test_sensitive_present_covers_the_other_containers():
    assert scan(jpeg(jpeg_app1_xmp(PLAIN_XMP))).sensitive_present
    assert scan(jpeg(jpeg_iptc())).sensitive_present
    assert scan(jpeg(jpeg_comment())).sensitive_present
    assert not scan(jpeg(jpeg_app2_icc())).sensitive_present  # a colour profile is not private
    assert not scan(jpeg()).sensitive_present
