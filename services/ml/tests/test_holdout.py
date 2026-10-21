import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

from sentinel_ml.holdout import parse_holdout_config, select_holdout_groups
from sentinel_ml.schemas import feature_names
from sentinel_ml.train import train

SCHEMA = "cicids2017-v1"
SHIFTS = {"BENIGN": 0.0, "DDoS": 6.0, "PortScan": -6.0}


def day_csv(path: Path, labels: list[str], seed: int, n: int = 60, site: str = "a") -> Path:
    """One capture day: separable synthetic flows of the given classes (pipeline tests only)."""
    rng = np.random.default_rng(seed)
    names = feature_names(SCHEMA)
    frames = []
    for label in labels:
        X = rng.normal(loc=SHIFTS[label], scale=1.0, size=(n, len(names)))
        df = pd.DataFrame(X, columns=[f" {c}" for c in names])
        df[" Source IP"] = [f"10.{seed}.{labels.index(label)}.{i % 5}" for i in range(n)]
        df[" Label"] = label
        df[" Site"] = site
        frames.append(df)
    pd.concat(frames, ignore_index=True).to_csv(path, index=False)
    return path


def run(root: Path, holdout: dict | None, files: list[str]) -> Path:
    cfg = {
        "name": "holdout-test",
        "version_prefix": "ho",
        "schema": SCHEMA,
        "data": {"csv": files},
        "split": {"test_size": 0.2, "val_size": 0.2, "seed": 3, **({"holdout": holdout} if holdout else {})},
        "models": ["logistic_regression"],
        "class_weights": ["none"],
        "output_dir": "artifacts",
    }
    (root / "cfg.yaml").write_text(yaml.safe_dump(cfg), encoding="utf-8")
    return train(root / "cfg.yaml")


@pytest.fixture()
def days(tmp_path) -> Path:
    day_csv(tmp_path / "monday.csv", ["BENIGN"], 1)
    day_csv(tmp_path / "tuesday.csv", ["BENIGN", "PortScan"], 2)
    day_csv(tmp_path / "friday.csv", ["BENIGN", "DDoS"], 3, site="b")
    day_csv(tmp_path / "wednesday.csv", ["BENIGN", "DDoS", "PortScan"], 4)
    return tmp_path


FILES = ["monday.csv", "tuesday.csv", "friday.csv", "wednesday.csv"]


def test_holding_out_a_day_reports_per_class_metrics_on_it(days):
    out = run(days, {"by": "file", "groups": ["friday.csv"]}, FILES)
    held = json.loads((out / "metrics.json").read_text())["heldOut"]
    assert held["status"] == "ok" and held["by"] == "file" and held["groups"] == ["friday.csv"]
    assert {c["label"] for c in held["perClass"]} == {"DDoS", "Normal"}
    assert held["rows"] == 120 and held["perGroup"][0]["group"] == "friday.csv"
    # PortScan exists in training but not on Friday: no estimate, said out loud.
    assert held["classesMissingFromHoldout"] == ["PortScan"]
    assert any("PortScan" in w and "no estimate" in w for w in held["warnings"])
    meta = json.loads((out / "meta.json").read_text())
    assert meta["trainedOn"]["heldOut"]["groups"] == ["friday.csv"]
    # The held-out rows never reach training: 3 days x ~60-180 rows remain, not 4 days.
    assert sum(meta["trainedOn"]["classCounts"].values()) == 60 + 120 + 180
    card = (out / "model_card.md").read_text(encoding="utf-8")
    assert "Held-out file" in card and "friday.csv" in card and "PortScan" in card


def test_unseen_class_rows_are_excluded_not_guessed(tmp_path):
    day_csv(tmp_path / "a.csv", ["BENIGN", "DDoS"], 1)
    day_csv(tmp_path / "b.csv", ["BENIGN", "DDoS"], 2)
    day_csv(tmp_path / "c.csv", ["BENIGN", "PortScan"], 3)
    out = run(tmp_path, {"by": "file", "groups": ["c.csv"]}, ["a.csv", "b.csv", "c.csv"])
    held = json.loads((out / "metrics.json").read_text())["heldOut"]
    assert held["classesUnseenInTraining"] == ["PortScan"]
    assert held["rowsExcludedUnseenClass"] == 60
    assert "PortScan" not in {c["label"] for c in held["perClass"]}
    assert any("never seen in training" in w for w in held["warnings"])
    assert "DDoS" in held["classesMissingFromHoldout"]


def test_holdout_by_a_column(days):
    out = run(days, {"by": "Site", "groups": ["b"]}, FILES)
    held = json.loads((out / "metrics.json").read_text())["heldOut"]
    assert held["status"] == "ok" and held["by"] == "Site" and held["groups"] == ["b"] and held["rows"] == 120


def test_no_holdout_is_reported_as_not_configured(days):
    out = run(days, None, FILES)
    assert json.loads((out / "metrics.json").read_text())["heldOut"] == {"status": "not_configured"}
    assert "Not configured" in (out / "model_card.md").read_text(encoding="utf-8")


def test_a_pattern_matching_nothing_is_an_error_not_a_silent_empty_test_set():
    values = pd.Series(["a.csv", "b.csv", "c.csv"])
    with pytest.raises(ValueError, match="match none"):
        select_holdout_groups(values, ["thursday*"], 0.25, 1)
    with pytest.raises(ValueError, match="Every group"):
        select_holdout_groups(values, ["*.csv"], 0.25, 1)
    with pytest.raises(ValueError, match="at least two groups"):
        select_holdout_groups(pd.Series(["a.csv"] * 3), None, 0.25, 1)


def test_fraction_selection_is_seeded_and_glob_selection_works():
    values = pd.Series([f"day{i}.csv" for i in range(8)] * 2)
    assert select_holdout_groups(values, None, 0.25, 7) == select_holdout_groups(values, None, 0.25, 7)
    assert len(select_holdout_groups(values, None, 0.25, 7)) == 2
    assert select_holdout_groups(values, ["day1*", "day7.csv"], 0.25, 7) == ["day1.csv", "day7.csv"]


def test_config_validation():
    assert parse_holdout_config(None) is None
    assert parse_holdout_config({"by": "none"}) is None
    assert parse_holdout_config({"by": "FILE"})["by"] == "file"
    with pytest.raises(ValueError):
        parse_holdout_config({"by": "file", "fraction": 1.5})
    with pytest.raises(ValueError):
        parse_holdout_config({"by": "file", "groups": "friday.csv"})
