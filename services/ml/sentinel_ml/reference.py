"""Compact training-time reference distribution, the baseline for drift checks (docs/ML_AND_DETECTION.md §9).

Per feature: decile-style bin edges taken from the training rows and the share of
training rows in each bin. The drift job (apps/api) bins recent scored flows with
the same edges and computes the population stability index (PSI), so only this
small file travels with the model, never the training data.

Bin i covers (edges[i-1], edges[i]]; the first bin is open below and the last is
open above, so a shifted distribution cannot fall outside the histogram.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

DEFAULT_BINS = 10
REFERENCE_FILE = "reference.json"


def bin_counts(values: np.ndarray, edges: list[float]) -> np.ndarray:
    """Counts per bin for the finite values (len(edges) + 1 bins); NaN / inf are left out."""
    finite = values[np.isfinite(values)]
    idx = np.searchsorted(np.asarray(edges, dtype=float), finite, side="left")
    return np.bincount(idx, minlength=len(edges) + 1)


def build_reference(X: pd.DataFrame, y: pd.Series, schema_id: str, bins: int = DEFAULT_BINS) -> dict:
    features: dict[str, dict] = {}
    for col in X.columns:
        values = X[col].to_numpy(dtype=float)
        finite = values[np.isfinite(values)]
        if finite.size == 0:
            features[col] = {"edges": [], "proportions": [], "missing": 1.0}
            continue
        # Repeated quantiles (many zeros) collapse into one edge instead of empty bins.
        edges = sorted({float(q) for q in np.quantile(finite, np.linspace(0, 1, bins + 1)[1:-1])})
        counts = bin_counts(values, edges)
        features[col] = {
            "edges": edges,
            "proportions": [round(float(c) / finite.size, 6) for c in counts],
            "missing": round(1 - finite.size / values.size, 6),
        }
    return {
        "schema": schema_id,
        "rows": int(len(X)),
        "bins": bins,
        "classProportions": {str(k): round(float(v), 6) for k, v in y.value_counts(normalize=True).sort_index().items()},
        "features": features,
    }
