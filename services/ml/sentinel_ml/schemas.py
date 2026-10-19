"""Feature schemas, read from the JSON files owned by packages/shared."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

_DEFAULT_DIR = Path(__file__).resolve().parents[3] / "packages" / "shared" / "src" / "feature-schemas"


def schemas_dir() -> Path:
    return Path(os.environ.get("SENTINEL_FEATURE_SCHEMAS_DIR", _DEFAULT_DIR))


@lru_cache(maxsize=8)
def load_feature_schema(schema_id: str) -> dict:
    path = schemas_dir() / f"{schema_id}.json"
    if not path.is_file():
        raise KeyError(f"Unknown feature schema: {schema_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def feature_names(schema_id: str) -> list[str]:
    return [f["name"] for f in load_feature_schema(schema_id)["features"]]
