import hashlib
import json

from sentinel_ml.schemas import feature_names


def test_artefacts_are_complete(trained_model):
    for name in [
        "model.joblib",
        "feature_schema.json",
        "metrics.json",
        "model_card.md",
        "training_config.yaml",
        "env.json",
        "meta.json",
        "SHA256SUMS",
    ]:
        assert (trained_model / name).is_file(), name


def test_checksums_match(trained_model):
    for line in (trained_model / "SHA256SUMS").read_text().splitlines():
        digest, name = line.split("  ")
        assert hashlib.sha256((trained_model / name).read_bytes()).hexdigest() == digest


def test_metrics_are_honest(trained_model):
    meta = json.loads((trained_model / "meta.json").read_text())
    m = meta["metrics"]
    assert m["macroF1"] is not None
    assert {c["label"] for c in m["perClass"]} == {"DDoS", "Normal", "PortScan"}
    for c in m["perClass"]:
        assert {"precision", "recall", "f1", "support", "unstable"} <= c.keys()
        assert c["unstable"] == (c["support"] < 30)
    assert meta["libVersions"]["scikit-learn"]
    assert meta["trainedOn"]["rows_unknown_label"] == 1
    assert meta["trainedOn"]["unknown_labels"] == {"Totally Unknown": 1}
    assert meta["trainedOn"]["non_finite_values"] >= 1
    metrics = json.loads((trained_model / "metrics.json").read_text())
    assert len(metrics["selection"]["candidates"]) == 3
    assert metrics["groupAware"]["status"] == "ok"
    assert metrics["test"]["calibration"]["ece"] is not None


def test_feature_schema_copied(trained_model):
    copied = json.loads((trained_model / "feature_schema.json").read_text())
    assert [f["name"] for f in copied["features"]] == feature_names("cicids2017-v1")


def test_model_card_mentions_limits(trained_model):
    card = (trained_model / "model_card.md").read_text(encoding="utf-8")
    assert "Macro-F1" in card and "Known limitations" in card and "Group-aware" in card
