import json
import shutil

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from sentinel_ml.api import create_app
from sentinel_ml.novelty import fit_novelty
from sentinel_ml.reference import bin_counts, build_reference
from sentinel_ml.schemas import feature_names

NAMES = feature_names("cicids2017-v1")
TOKEN = "t" * 20
H = {"x-internal-token": TOKEN}


def flow(fid, shift):
    return {"id": fid, "features": {n: shift for n in NAMES}}


@pytest.fixture()
def client(trained_model):
    version = json.loads((trained_model / "meta.json").read_text())["version"]
    return TestClient(create_app(trained_model.parent, token=TOKEN)), version


def test_reference_histogram_is_compact_and_consistent(trained_model):
    ref = json.loads((trained_model / "reference.json").read_text())
    assert set(ref["features"]) == set(NAMES)
    assert ref["schema"] == "cicids2017-v1" and ref["rows"] > 0
    assert abs(sum(ref["classProportions"].values()) - 1) < 1e-3
    for name, f in ref["features"].items():
        assert f["edges"] == sorted(f["edges"]), name
        assert len(f["proportions"]) == len(f["edges"]) + 1, name
        assert abs(sum(f["proportions"]) - 1) < 1e-3, name
    assert (trained_model / "reference.json").stat().st_size < 60_000
    assert json.loads((trained_model / "meta.json").read_text())["reference"]["bins"] == 10


def test_build_reference_collapses_repeated_values_and_counts_missing():
    X = pd.DataFrame({"a": [0.0] * 80 + list(range(1, 21)), "b": [np.nan] * 50 + [1.0] * 50})
    ref = build_reference(X, pd.Series(["Normal"] * 100), "cicids2017-v1")
    a = ref["features"]["a"]
    assert len(a["edges"]) < 9 and abs(sum(a["proportions"]) - 1) < 1e-3
    assert a["proportions"][0] >= 0.8  # the zeros stay together in the first bin
    assert ref["features"]["b"]["missing"] == 0.5
    # Values outside the training range still land in the open outer bins.
    counts = bin_counts(np.array([-1e9, 1e9, np.nan, np.inf]), a["edges"])
    assert counts[0] == 1 and counts[-1] == 1 and counts.sum() == 2


def test_reference_endpoint_and_older_models_without_it(client, trained_model, tmp_path):
    c, version = client
    r = c.get(f"/models/{version}/reference", headers=H)
    assert r.status_code == 200 and r.json()["features"]
    assert c.get("/models/nope/reference", headers=H).status_code == 404
    old = tmp_path / "artifacts" / "old-model"
    shutil.copytree(trained_model, old)
    (old / "reference.json").unlink()
    meta = json.loads((old / "meta.json").read_text())
    meta["version"] = "old-model"
    (old / "meta.json").write_text(json.dumps(meta))
    c2 = TestClient(create_app(old.parent, token=TOKEN))
    res = c2.get("/models/old-model/reference", headers=H)
    assert res.status_code == 404 and "retrain" in res.json()["detail"]


def test_novelty_is_trained_measured_and_reported(trained_model):
    metrics = json.loads((trained_model / "metrics.json").read_text())["novelty"]
    assert metrics["status"] == "ok" and metrics["quantile"] == 0.99
    assert metrics["benignFalsePositiveRate"] is not None
    # Known attacks are far from benign traffic: the report says how much of each class is above the threshold.
    assert {c["label"] for c in metrics["perClass"]} == {"DDoS", "PortScan"}
    assert all(c["flaggedShare"] > 0.9 for c in metrics["perClass"])
    meta = json.loads((trained_model / "meta.json").read_text())
    assert meta["novelty"]["threshold"] == metrics["threshold"]
    card = (trained_model / "model_card.md").read_text(encoding="utf-8")
    assert "Novelty detector" in card and "never mapped to an attack class" in card
    assert (trained_model / "novelty.joblib").is_file()


def test_predict_returns_a_novelty_score_without_changing_the_label(client):
    c, version = client
    body = {"schema": "cicids2017-v1", "modelVersion": version, "flows": [flow("typical", 0.0), flow("far", 40.0)]}
    results = {r["id"]: r for r in c.post("/predict", json=body, headers=H).json()["results"]}
    typical, far = results["typical"]["novelty"], results["far"]["novelty"]
    assert typical["aboveThreshold"] is False and far["aboveThreshold"] is True
    assert far["score"] > far["threshold"] > 0
    # The novelty score is separate evidence: the class verdict is still one of the trained classes.
    assert results["far"]["label"] in {"Normal", "DDoS", "PortScan"}


def test_a_model_without_novelty_adds_no_novelty_field(trained_model, tmp_path):
    plain = tmp_path / "artifacts" / "plain"
    shutil.copytree(trained_model, plain)
    (plain / "novelty.joblib").unlink()
    meta = json.loads((plain / "meta.json").read_text())
    meta["version"] = "plain"
    (plain / "meta.json").write_text(json.dumps(meta))
    c = TestClient(create_app(plain.parent, token=TOKEN))
    body = {"schema": "cicids2017-v1", "modelVersion": "plain", "flows": [flow("a", 0.0)]}
    assert "novelty" not in c.post("/predict", json=body, headers=H).json()["results"][0]


def test_fit_novelty_refuses_too_few_benign_rows_and_a_bad_quantile():
    X = pd.DataFrame(np.random.default_rng(0).normal(size=(10, 3)))
    with pytest.raises(ValueError, match="at least"):
        fit_novelty(X, 1)
    with pytest.raises(ValueError, match="quantile"):
        fit_novelty(pd.DataFrame(np.zeros((100, 3))), 1, quantile=1.0)
