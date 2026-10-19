import json
import shutil

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from sentinel_ml.api import create_app
from sentinel_ml.explain import Explainer
from sentinel_ml.schemas import feature_names
from sentinel_ml.train import build_pipeline

NAMES = feature_names("cicids2017-v1")
TOKEN = "t" * 20
H = {"x-internal-token": TOKEN}


@pytest.fixture()
def client(trained_model):
    version = json.loads((trained_model / "meta.json").read_text())["version"]
    return TestClient(create_app(trained_model.parent, token=TOKEN)), version


def flow(fid, shift=0.0, **overrides):
    feats = {n: shift for n in NAMES}
    feats.update(overrides)
    return {"id": fid, "features": feats}


def test_health_is_public(client):
    c, _ = client
    assert c.get("/health").json()["status"] == "ok"


def test_token_required(client):
    c, _ = client
    assert c.get("/models").status_code == 401
    assert c.get("/models", headers={"x-internal-token": "wrong"}).status_code == 401
    assert c.get("/models", headers=H).status_code == 200


def test_predict_contract(client):
    c, version = client
    body = {
        "schema": "cicids2017-v1",
        "modelVersion": version,
        "explain": True,
        "flows": [flow("a", 6.0), flow("b", 0.0, **{"Flow Bytes/s": None})],
    }
    res = c.post("/predict", headers=H, json=body)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["modelVersion"] == version
    a, b = out["results"]
    assert a["label"] == "DDoS" and 0 <= a["confidence"] <= 1
    assert abs(sum(a["probabilities"].values()) - 1) < 1e-4
    assert 0 < len(a["topFeatures"]) <= 5
    assert b["label"] == "Normal"
    assert "topFeatures" not in b or b["confidence"] < 0.6


def test_missing_and_unknown_features_rejected(client):
    c, version = client
    f = flow("x")
    del f["features"]["Flow Duration"]
    f["features"]["Destination Port"] = 80
    res = c.post("/predict", headers=H, json={"schema": "cicids2017-v1", "modelVersion": version, "flows": [f]})
    assert res.status_code == 422
    assert "Flow Duration" in res.json()["detail"] and "Destination Port" in res.json()["detail"]


def test_schema_mismatch_and_unknown_version(client):
    c, version = client
    wrong_schema = {"schema": "sentinel-native-v1", "modelVersion": version, "flows": [flow("x")]}
    assert c.post("/predict", headers=H, json=wrong_schema).status_code == 409
    unknown = {"schema": "cicids2017-v1", "modelVersion": "nope", "flows": [flow("x")]}
    assert c.post("/predict", headers=H, json=unknown).status_code == 404


def test_version_mismatch_blocks_loading(trained_model, tmp_path):
    target = tmp_path / "old"
    shutil.copytree(trained_model, target)
    meta = json.loads((target / "meta.json").read_text())
    meta["version"] = "old"
    meta["libVersions"]["scikit-learn"] = "0.24.2"
    (target / "meta.json").write_text(json.dumps(meta))
    c = TestClient(create_app(tmp_path, token=""))
    listed = c.get("/models").json()["models"][0]
    assert listed["loadBlocked"] is True and listed["versionWarnings"]
    res = c.post("/predict", json={"schema": "cicids2017-v1", "modelVersion": "old", "flows": [flow("x")]})
    assert res.status_code == 409 and "Retrain" in res.json()["detail"]


@pytest.mark.parametrize("algorithm", ["random_forest", "hist_gradient_boosting", "logistic_regression"])
def test_explanations_reconstruct_multiclass_output(algorithm):
    rng = np.random.default_rng(3)
    X = pd.DataFrame(rng.normal(size=(300, len(NAMES))), columns=NAMES)
    y = np.where(
        X["Flow Duration"] + X["SYN Flag Count"] > 0.5,
        "DDoS",
        np.where(X["Idle Mean"] > 0.8, "PortScan", "Normal"),
    )
    X.iloc[0, 3] = np.nan  # imputed values must still reconstruct
    pipe = build_pipeline(algorithm, None, 0).fit(X, y)
    ex = Explainer(pipe, NAMES)
    sample = X.iloc[:25]
    contrib, base = ex.contributions(sample)
    np.testing.assert_allclose(base[None, :] + contrib.sum(axis=1), ex.model_output(sample), atol=1e-4)


@pytest.mark.parametrize("algorithm", ["random_forest", "hist_gradient_boosting", "logistic_regression"])
def test_explanations_reconstruct_binary_output(algorithm):
    rng = np.random.default_rng(4)
    X = pd.DataFrame(rng.normal(size=(200, len(NAMES))), columns=NAMES)
    y = np.where(X["Flow Duration"] > 0, "DDoS", "Normal")
    pipe = build_pipeline(algorithm, None, 0).fit(X, y)
    ex = Explainer(pipe, NAMES)
    contrib, base = ex.contributions(X.iloc[:10])
    np.testing.assert_allclose(base[None, :] + contrib.sum(axis=1), ex.model_output(X.iloc[:10]), atol=1e-4)
