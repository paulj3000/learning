"""LAI-07 W4: one asset-id rule and agreeing glTF node transforms across modules."""

import math

import pytest

from apps.assets import formats, gltf_prep, importer, storage, validation

GOOD_IDS = ["a", "tree-01", "pirate-ship", "x9-y8-z7"]
BAD_IDS = ["", "Tree", "a--b", "-a", "a-", "a_b", "a b", "a.b", "tree-"]


def test_single_asset_id_pattern_object():
    assert importer.ASSET_ID is formats.ASSET_ID
    assert storage.ASSET_ID is formats.ASSET_ID
    assert validation.ASSET_ID is formats.ASSET_ID


@pytest.mark.parametrize("module", [importer, storage, validation])
def test_modules_accept_and_reject_the_same_ids(module):
    assert all(module.ASSET_ID.match(value) for value in GOOD_IDS)
    assert not any(module.ASSET_ID.match(value) for value in BAD_IDS)


def _gltf_prep_matrix(node):
    """The 4x4 column-major matrix of gltf_prep's local transform (basis vectors and origin)."""
    origin = gltf_prep._local_transform(node, (0, 0, 0))
    columns = []
    for axis in ((1, 0, 0), (0, 1, 0), (0, 0, 1)):
        moved = gltf_prep._local_transform(node, axis)
        columns.extend([*(moved[i] - origin[i] for i in range(3)), 0.0])
    return [*columns, *origin, 1.0]


@pytest.mark.parametrize(
    "node",
    [
        {},
        {"translation": [1, -2, 3.5]},
        {"scale": [2, 3, 0.5]},
        {
            "translation": [0.5, 1, -4],
            "rotation": [0.0, math.sin(math.pi / 6), 0.0, math.cos(math.pi / 6)],
            "scale": [1.5, 2, 3],
        },
    ],
)
def test_trs_node_matrix_agrees_between_validation_and_gltf_prep(node):
    expected = validation._node_matrix(node)
    actual = _gltf_prep_matrix(node)
    assert actual == pytest.approx(expected, abs=1e-9)


def test_matrix_node_is_read_by_validation_only():
    # gltf_prep extracts from TRS nodes alone (a matrix node is ignored there); validation reads
    # the matrix verbatim, so the two are deliberately not unified for matrix nodes.
    matrix = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 4, 5, 6, 1.0]
    assert validation._node_matrix({"matrix": matrix}) == matrix
