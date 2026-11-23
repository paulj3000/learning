"""nginx lets an asset upload at Django's largest limit through (50 MiB plus multipart overhead).

Both nginx templates (native dev and the EC2 image) must allow a 50 MiB = 52,428,800 byte file
(`LAI_ASSET_MAX_UPLOAD_BYTES` default and the `LAI_ASSET_MAX_GLB_BYTES` ceiling) plus at least
1 MiB of multipart overhead, so Django, not nginx, gives staff the readable refusal. No network.
"""

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
TEMPLATES = [
    REPO / "deploy/native/nginx.conf.template",
    REPO / "deploy/ec2/nginx/default.conf.template",
]
MIB = 1024 * 1024
DJANGO_LIMIT = 50 * MIB  # 52,428,800 bytes
UNITS = {"": 1, "k": 1024, "m": MIB, "g": 1024 * MIB}


def body_limit(text: str) -> int:
    values = re.findall(r"^\s*client_max_body_size\s+(\d+)([kKmMgG]?)\s*;", text, re.M)
    assert len(values) == 1, values  # one http-level value, not overridden per server
    number, unit = values[0]
    return int(number) * UNITS[unit.lower()]


def test_django_defaults_match():
    base = (REPO / "lai/config/settings/base.py").read_text()
    assert '"LAI_ASSET_MAX_UPLOAD_BYTES", "52428800"' in base
    assert '"LAI_ASSET_MAX_GLB_BYTES", "52428800"' in base
    assert "LAI_ASSET_GLB_CEILING_BYTES = 50 * 1024 * 1024" in base


@pytest.mark.parametrize("template", TEMPLATES, ids=lambda p: p.parent.name)
def test_nginx_allows_the_largest_upload_plus_multipart_overhead(template):
    limit = body_limit(template.read_text())
    assert limit == 55 * MIB == 57_671_680
    assert limit - DJANGO_LIMIT >= MIB
