import json
from pathlib import Path

import pytest

from sentinel_ml.labels import normalize_label

VECTORS = Path(__file__).resolve().parents[3] / "packages" / "shared" / "test-vectors" / "labels.json"
CASES = json.loads(VECTORS.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("raw,expected", CASES)
def test_shared_label_vectors(raw, expected):
    assert normalize_label(raw) == expected


def test_non_string_is_unknown():
    assert normalize_label(None) is None
    assert normalize_label(3) is None
