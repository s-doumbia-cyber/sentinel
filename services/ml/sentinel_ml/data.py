"""Training data loading and cleaning for CICIDS2017-style CSV exports."""

from __future__ import annotations

import glob
import hashlib
import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from .labels import normalize_label
from .schemas import feature_names

log = logging.getLogger("sentinel_ml.data")

LABEL_COLUMN = "Label"
GROUP_COLUMN = "Source IP"


@dataclass
class DatasetReport:
    files: list[dict] = field(default_factory=list)
    rows_read: int = 0
    rows_unknown_label: int = 0
    unknown_labels: dict[str, int] = field(default_factory=dict)
    rows_missing_label: int = 0
    duplicates_dropped: int = 0
    rows_capped: int = 0
    non_finite_values: int = 0
    class_counts: dict[str, int] = field(default_factory=dict)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve_paths(patterns: list[str], base: Path) -> list[Path]:
    paths: list[Path] = []
    for pattern in patterns:
        p = Path(pattern)
        full = p if p.is_absolute() else base / p
        matches = sorted(Path(m) for m in glob.glob(str(full)))
        if not matches:
            raise FileNotFoundError(f"No CSV matches {pattern!r} (resolved against {base})")
        paths.extend(matches)
    return paths


def _dedupe_columns(columns: list[str]) -> list[str]:
    """Trim headers and suffix repeats (CICIDS2017 repeats "Fwd Header Length")."""
    seen: dict[str, int] = {}
    out = []
    for c in columns:
        t = c.strip()
        n = seen.get(t, 0)
        seen[t] = n + 1
        out.append(t if n == 0 else f"{t}__dup{n}")
    return out


def load_csvs(
    paths: list[Path],
    schema_id: str,
    max_rows_per_class: int | None = None,
    seed: int = 42,
) -> tuple[pd.DataFrame, pd.Series, pd.Series, DatasetReport]:
    """Returns (X, y, groups, report). Unknown labels are dropped and counted, never guessed."""
    features = feature_names(schema_id)
    report = DatasetReport()
    frames = []
    for path in paths:
        df = pd.read_csv(path, low_memory=False, encoding_errors="replace")
        df.columns = _dedupe_columns(list(df.columns))
        missing = [c for c in [*features, LABEL_COLUMN] if c not in df.columns]
        if missing:
            raise ValueError(f"{path.name} lacks required columns for {schema_id}: {missing[:8]}")
        report.files.append({"name": path.name, "sha256": sha256_file(path), "rows": int(len(df))})
        report.rows_read += len(df)
        keep = features + [LABEL_COLUMN] + ([GROUP_COLUMN] if GROUP_COLUMN in df.columns else [])
        frames.append(df[keep])
    data = pd.concat(frames, ignore_index=True)

    raw_labels = data[LABEL_COLUMN]
    missing_label = raw_labels.isna() | (raw_labels.astype(str).str.strip() == "")
    report.rows_missing_label = int(missing_label.sum())
    data = data[~missing_label].copy()
    data["_y"] = data[LABEL_COLUMN].map(normalize_label)
    unknown = data["_y"].isna()
    report.rows_unknown_label = int(unknown.sum())
    report.unknown_labels = {str(k): int(v) for k, v in data.loc[unknown, LABEL_COLUMN].value_counts().items()}
    if report.rows_unknown_label:
        log.warning("Dropped %d rows with unknown labels: %s", report.rows_unknown_label, report.unknown_labels)
    data = data[~unknown]

    X = data[features].apply(pd.to_numeric, errors="coerce").astype("float64")
    non_finite = ~np.isfinite(X.to_numpy())
    report.non_finite_values = int(non_finite.sum())
    # Documented policy: non-finite -> NaN, imputed with the training median by the pipeline.
    X = X.mask(~np.isfinite(X))

    before = len(X)
    dup = pd.concat([X, data["_y"]], axis=1).duplicated()
    X, data = X[~dup], data[~dup]
    report.duplicates_dropped = int(before - len(X))

    y = data["_y"].astype(str)
    groups = data[GROUP_COLUMN].astype(str) if GROUP_COLUMN in data.columns else pd.Series(["unknown"] * len(y), index=y.index)

    if max_rows_per_class:
        rng = np.random.default_rng(seed)
        idx = []
        for _cls, cls_idx in y.groupby(y).groups.items():
            cls_idx = np.asarray(cls_idx)
            if len(cls_idx) > max_rows_per_class:
                cls_idx = rng.choice(cls_idx, size=max_rows_per_class, replace=False)
            idx.extend(cls_idx.tolist())
        idx = sorted(idx)
        report.rows_capped = int(len(y) - len(idx))
        X, y, groups = X.loc[idx], y.loc[idx], groups.loc[idx]

    report.class_counts = {str(k): int(v) for k, v in y.value_counts().sort_index().items()}
    return X.reset_index(drop=True), y.reset_index(drop=True), groups.reset_index(drop=True), report
