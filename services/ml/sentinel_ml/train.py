"""sentinel-train: config-driven, reproducible training (docs/ML_AND_DETECTION.md §4).

    sentinel-train --config configs/cicids-sample.yaml

Writes one artefact directory per version. Never activates anything: activation
is an Owner/Admin action in the Sentinel UI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import platform
import shutil
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import yaml
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .data import load_csvs, resolve_paths
from .labels import CRITICAL_CLASSES
from .metrics import evaluate, min_recall
from .model_card import render_model_card
from .schemas import load_feature_schema, schemas_dir

log = logging.getLogger("sentinel_ml.train")

MIN_ROWS_PER_CLASS = 5
ALGORITHMS = ("logistic_regression", "random_forest", "hist_gradient_boosting")


def build_pipeline(algorithm: str, class_weight: str | None, seed: int) -> Pipeline:
    cw = None if class_weight in (None, "none") else class_weight
    impute = ("impute", SimpleImputer(strategy="median", keep_empty_features=True))
    if algorithm == "logistic_regression":
        return Pipeline([impute, ("scale", StandardScaler()), ("model", LogisticRegression(max_iter=2000, class_weight=cw))])
    if algorithm == "random_forest":
        return Pipeline([impute, ("model", RandomForestClassifier(n_estimators=100, n_jobs=-1, random_state=seed, class_weight=cw))])
    if algorithm == "hist_gradient_boosting":
        return Pipeline([impute, ("model", HistGradientBoostingClassifier(max_iter=200, random_state=seed, class_weight=cw))])
    raise ValueError(f"Unknown algorithm {algorithm!r}; expected one of {ALGORITHMS}")


def lib_versions() -> dict[str, str]:
    import shap
    import sklearn

    return {
        "python": platform.python_version(),
        "scikit-learn": sklearn.__version__,
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "joblib": joblib.__version__,
        "shap": shap.__version__,
        "platform": platform.platform(),
    }


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _group_evaluation(X, y, groups, algorithm, class_weight, classes, seed) -> dict:
    """Group-aware holdout by source IP: exposes leakage that random splits hide."""
    unique = groups.nunique()
    if unique < 2:
        return {"status": "not_possible", "reason": "all rows share one source IP group"}
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=seed)
    tr, te = next(splitter.split(X, y, groups))
    train_classes, test_classes = set(y.iloc[tr]), set(y.iloc[te])
    note = {
        "groups": int(unique),
        "classesMissingFromTrain": sorted(test_classes - train_classes),
        "classesMissingFromTest": sorted(set(classes) - test_classes),
    }
    if len(train_classes) < 2:
        return {"status": "not_possible", "reason": "training side holds a single class", **note}
    pipe = build_pipeline(algorithm, class_weight, seed).fit(X.iloc[tr], y.iloc[tr])
    model_classes = [str(c) for c in pipe.classes_]
    m = evaluate(pipe, X.iloc[te], y.iloc[te], model_classes)
    return {"status": "ok", **note, "macroF1": m["macroF1"], "testRows": m["testRows"], "perClass": m["perClass"]}


def train(config_path: Path, csv_override: list[str] | None = None, output_override: Path | None = None) -> Path:
    config_path = config_path.resolve()
    base = config_path.parent
    cfg = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    if csv_override:
        cfg["data"]["csv"] = [str(Path(p).resolve()) for p in csv_override]
    schema_id = cfg["schema"]
    seed = int(cfg.get("split", {}).get("seed", 42))
    test_size = float(cfg.get("split", {}).get("test_size", 0.2))
    val_size = float(cfg.get("split", {}).get("val_size", 0.2))
    algorithms = cfg.get("models", list(ALGORITHMS))
    class_weights = cfg.get("class_weights", ["none", "balanced"])
    critical_min = float(cfg.get("selection", {}).get("critical_min_recall", 0.5))
    load_feature_schema(schema_id)

    paths = resolve_paths(cfg["data"]["csv"], base)
    X, y, groups, report = load_csvs(paths, schema_id, cfg["data"].get("max_rows_per_class"), seed)
    counts = y.value_counts()
    excluded = sorted(counts[counts < MIN_ROWS_PER_CLASS].index.tolist())
    if excluded:
        keep = ~y.isin(excluded)
        X, y, groups = X[keep].reset_index(drop=True), y[keep].reset_index(drop=True), groups[keep].reset_index(drop=True)
    classes = sorted(y.unique().tolist())
    if len(classes) < 2:
        raise ValueError(f"Need at least two classes to train; found {classes}")
    log.info("Loaded %d rows, classes=%s, excluded=%s", len(y), classes, excluded)

    X_trval, X_test, y_trval, y_test = train_test_split(X, y, test_size=test_size, stratify=y, random_state=seed)
    X_train, X_val, y_train, y_val = train_test_split(
        X_trval, y_trval, test_size=val_size / (1 - test_size), stratify=y_trval, random_state=seed
    )

    candidates = []
    for algorithm in algorithms:
        for cw in class_weights:
            t0 = time.perf_counter()
            pipe = build_pipeline(algorithm, cw, seed).fit(X_train, y_train)
            fit_s = time.perf_counter() - t0
            m = evaluate(pipe, X_val, y_val, [str(c) for c in pipe.classes_])
            crit = min_recall(m, list(CRITICAL_CLASSES))
            candidates.append(
                {
                    "algorithm": algorithm,
                    "classWeight": cw,
                    "valMacroF1": m["macroF1"],
                    "valWeightedF1": m["weightedF1"],
                    "valMinCriticalRecall": crit,
                    "latencyMsPer1000": m["latencyMsPer1000"],
                    "fitSeconds": round(fit_s, 2),
                }
            )
            log.info("%s/%s: val macro-F1=%.4f", algorithm, cw, m["macroF1"] or 0)

    eligible = [c for c in candidates if c["valMinCriticalRecall"] is None or c["valMinCriticalRecall"] >= critical_min]
    selection_warning = None
    if not eligible:
        eligible = candidates
        selection_warning = f"No candidate reached the minimum recall {critical_min} on critical classes"
    best = sorted(eligible, key=lambda c: (-(c["valMacroF1"] or 0), c["latencyMsPer1000"] or 0))[0]

    # Final model on train+val, evaluated once on the untouched test set.
    final = build_pipeline(best["algorithm"], best["classWeight"], seed).fit(X_trval, y_trval)
    model_classes = [str(c) for c in final.classes_]
    test_metrics = evaluate(final, X_test, y_test, model_classes)
    group_eval = _group_evaluation(X, y, groups, best["algorithm"], best["classWeight"], classes, seed)

    now = datetime.now(timezone.utc)
    version = f"{cfg.get('version_prefix', 'model')}-{now.strftime('%Y.%m.%d-%H%M%S')}"
    out_root = output_override.resolve() if output_override else (base / cfg.get("output_dir", "../artifacts")).resolve()
    out = out_root / version
    out.mkdir(parents=True, exist_ok=False)

    joblib.dump({"pipeline": final, "classes": model_classes, "features": list(X.columns), "schema": schema_id}, out / "model.joblib")
    shutil.copyfile(schemas_dir() / f"{schema_id}.json", out / "feature_schema.json")
    (out / "training_config.yaml").write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    env = lib_versions()
    (out / "env.json").write_text(json.dumps(env, indent=2), encoding="utf-8")

    metrics = {
        "test": test_metrics,
        "selection": {"candidates": candidates, "chosen": best, "criticalMinRecall": critical_min, "warning": selection_warning},
        "groupAware": group_eval,
        "split": {"train": int(len(y_train)), "validation": int(len(y_val)), "test": int(len(y_test)), "seed": seed},
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    meta = {
        "version": version,
        "name": cfg.get("name", version),
        "schema": schema_id,
        "kind": cfg.get("kind", "benchmark"),
        "algorithm": best["algorithm"],
        "classWeight": best["classWeight"],
        "trainedAt": now.isoformat(),
        "classes": model_classes,
        "metrics": {k: test_metrics[k] for k in ("macroF1", "weightedF1", "mcc", "testRows", "perClass")},
        "trainedOn": {
            **asdict(report),
            "rows": int(len(y)),
            "classCounts": {str(k): int(v) for k, v in y.value_counts().sort_index().items()},
            "excludedClasses": excluded,
            "description": cfg.get("description", ""),
        },
        "libVersions": env,
        "sha256": _sha256(out / "model.joblib"),
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    (out / "model_card.md").write_text(render_model_card(meta, metrics, cfg), encoding="utf-8")
    sums = [f"{_sha256(p)}  {p.name}" for p in sorted(out.iterdir()) if p.is_file()]
    (out / "SHA256SUMS").write_text("\n".join(sums) + "\n", encoding="utf-8")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sentinel-train", description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--csv", action="append", help="CSV path or glob; overrides data.csv in the config (repeatable)")
    parser.add_argument("--output-dir", type=Path, help="Artefact root; overrides output_dir in the config")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    out = train(args.config, args.csv, args.output_dir)
    meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
    print(f"\nModel {meta['version']} ({meta['algorithm']}) written to {out}")
    print(f"Test macro-F1: {meta['metrics']['macroF1']}  (rows: {meta['metrics']['testRows']})")
    print(f"{'class':<14}{'precision':>10}{'recall':>8}{'f1':>8}{'support':>9}")
    for c in meta["metrics"]["perClass"]:
        flag = "  unstable estimate" if c["unstable"] else ""
        print(f"{c['label']:<14}{c['precision']!s:>10}{c['recall']!s:>8}{c['f1']!s:>8}{c['support']:>9}{flag}")
    print("\nNot activated. Activate it from Sentinel > Models (Owner/Admin).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
