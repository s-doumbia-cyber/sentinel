from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

from sentinel_ml.schemas import feature_names

SCHEMA = "cicids2017-v1"


def synthetic_csv(path: Path, n_per_class: int = 120, seed: int = 0) -> Path:
    """A small, clearly separable CICIDS2017-shaped dataset (for pipeline tests only)."""
    rng = np.random.default_rng(seed)
    names = feature_names(SCHEMA)
    frames = []
    for cls, label, shift in [(0, "BENIGN", 0.0), (1, "DDoS", 6.0), (2, "PortScan", -6.0)]:
        X = rng.normal(loc=shift, scale=1.0, size=(n_per_class, len(names)))
        df = pd.DataFrame(X, columns=[f" {n}" for n in names])  # leading spaces like the original files
        df[" Source IP"] = [f"10.0.{cls}.{i % 7}" for i in range(n_per_class)]
        df[" Label"] = label
        frames.append(df)
    data = pd.concat(frames, ignore_index=True)
    data.loc[0, " Flow Bytes/s"] = np.inf  # CICIDS-style non-finite value
    data.loc[1, " Label"] = "Totally Unknown"  # must be dropped, never guessed
    data.to_csv(path, index=False)
    return path


@pytest.fixture(scope="session")
def trained_model(tmp_path_factory) -> Path:
    from sentinel_ml.train import train

    root = tmp_path_factory.mktemp("ml")
    synthetic_csv(root / "train.csv")
    cfg = {
        "name": "test-model",
        "version_prefix": "test",
        "schema": SCHEMA,
        "kind": "benchmark",
        "description": "Synthetic test data.",
        "data": {"csv": ["train.csv"]},
        "split": {"test_size": 0.2, "val_size": 0.2, "seed": 1},
        "models": ["logistic_regression", "random_forest", "hist_gradient_boosting"],
        "class_weights": ["none"],
        "output_dir": "artifacts",
    }
    (root / "cfg.yaml").write_text(yaml.safe_dump(cfg), encoding="utf-8")
    return train(root / "cfg.yaml")
