"""
Trains and compares three real classifiers to predict the ATTACK TYPE
(multi-class, not just attack/normal) using a broader set of genuine
CICIDS2017 flow features pulled from MongoDB's `raw` field — the raw CSV
row is stored on every NetworkFlow document specifically so this script can
reach past the handful of normalized fields and use the dataset's real
feature set (flow timing, packet size, TCP flag counts, byte/packet rates).

Usage (from backend/):
    pip install -r ml/requirements.txt
    python ml/train_model.py

Writes backend/data/model-metrics.json, served at GET /api/ml/metrics.
"""

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from pymongo import MongoClient
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/cyber_threat_dashboard")
MAX_ROWS = 150_000  # cap for training speed on a laptop; still a large, representative sample

# Real CICIDS2017 feature names as they appear in the original CSV header
# (GeneratedLabelledFlows format). Not every column exists in every file —
# `load_data()` below only keeps the ones actually present.
CANDIDATE_FEATURES = [
    "Flow Duration",
    "Total Fwd Packets",
    "Total Backward Packets",
    "Total Length of Fwd Packets",
    "Total Length of Bwd Packets",
    "Flow Bytes/s",
    "Flow Packets/s",
    "Flow IAT Mean",
    "Flow IAT Std",
    "Fwd IAT Mean",
    "Bwd IAT Mean",
    "Fwd PSH Flags",
    "SYN Flag Count",
    "ACK Flag Count",
    "RST Flag Count",
    "PSH Flag Count",
    "Average Packet Size",
    "Min Packet Length",
    "Max Packet Length",
]

# GradientBoosting is far slower than RandomForest on 100k+ rows; train it on
# a smaller stratified subsample so the whole script still finishes in a
# reasonable time on a laptop, without skipping the model entirely.
GB_MAX_ROWS = 30_000


def load_data():
    client = MongoClient(MONGO_URI)
    db = client.get_default_database()
    # IMPORTANT: .find().limit() returns documents in natural (insertion)
    # order, so on a collection built from several separate imports it only
    # ever sees whichever file(s) were inserted first — silently collapsing
    # a "multi-class" run down to whatever 1-2 attack types happened to be
    # imported earliest. $sample draws a true random sample across the ENTIRE
    # collection, so every imported attack type has a chance of appearing.
    cursor = db.networkflows.aggregate([
        {"$sample": {"size": MAX_ROWS}},
        {"$project": {"raw": 1, "label": 1}},
    ])
    rows = list(cursor)
    client.close()
    if not rows:
        raise RuntimeError("No flows found in MongoDB. Import a dataset first (npm run import).")

    records = []
    for r in rows:
        raw = r.get("raw") or {}
        rec = {k: raw.get(k) for k in CANDIDATE_FEATURES if k in raw}
        rec["label"] = r["label"]
        records.append(rec)
    return pd.DataFrame(records)


def clean_features(df, feature_cols):
    X = df[feature_cols].apply(pd.to_numeric, errors="coerce")
    X = X.replace([np.inf, -np.inf], np.nan).fillna(0)
    return X


def evaluate(name, model, X_train, X_test, y_train, y_test, class_names):
    model.fit(X_train, y_train)
    y_pred = model.predict(X_test)
    metrics = {
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "precision": round(float(precision_score(y_test, y_pred, average="weighted", zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, y_pred, average="weighted", zero_division=0)), 4),
        "f1": round(float(f1_score(y_test, y_pred, average="weighted", zero_division=0)), 4),
    }
    print(f"[{name}] accuracy={metrics['accuracy']:.3f}  f1={metrics['f1']:.3f}")
    return metrics, y_pred


def main():
    print(f"[ml] Connecting to {MONGO_URI} ...")
    df = load_data()
    print(f"[ml] Loaded {len(df)} flows.")

    feature_cols = [c for c in CANDIDATE_FEATURES if c in df.columns]
    if len(feature_cols) < 4:
        raise RuntimeError(
            f"Too few usable features found in the imported data's raw CSV columns: {feature_cols}. "
            "The CSV's column names may differ from CANDIDATE_FEATURES — check with a CSV header dump."
        )
    print(f"[ml] Using {len(feature_cols)} features: {feature_cols}")

    label_counts = df["label"].value_counts()
    usable_labels = label_counts[label_counts >= 2].index  # stratified split needs >=2 per class
    dropped = set(df["label"].unique()) - set(usable_labels)
    if dropped:
        print(f"[ml] Dropping classes with <2 samples (can't stratify): {sorted(dropped)}")
    df = df[df["label"].isin(usable_labels)]

    X_all = clean_features(df, feature_cols)
    y_all = df["label"]

    encoder = LabelEncoder()
    y_encoded = encoder.fit_transform(y_all)
    class_names = list(encoder.classes_)

    X_train, X_test, y_train, y_test = train_test_split(
        X_all, y_encoded, test_size=0.25, random_state=42, stratify=y_encoded
    )

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # Gradient Boosting trains on a stratified subsample of the training set
    # to stay fast; RandomForest and LogisticRegression use the full split.
    if len(X_train) > GB_MAX_ROWS:
        gb_X, _, gb_y, _ = train_test_split(
            X_train, y_train, train_size=GB_MAX_ROWS, random_state=42, stratify=y_train
        )
    else:
        gb_X, gb_y = X_train, y_train

    models_results = {}
    predictions = {}

    print("[ml] Training RandomForest ...")
    rf = RandomForestClassifier(n_estimators=200, max_depth=15, n_jobs=-1, random_state=42)
    models_results["RandomForest"], predictions["RandomForest"] = evaluate(
        "RandomForest", rf, X_train, X_test, y_train, y_test, class_names
    )

    print(f"[ml] Training GradientBoosting (on {len(gb_X)} subsampled rows for speed) ...")
    gb = GradientBoostingClassifier(n_estimators=80, max_depth=4, random_state=42)
    models_results["GradientBoosting"], predictions["GradientBoosting"] = evaluate(
        "GradientBoosting", gb, gb_X, X_test, gb_y, y_test, class_names
    )

    print("[ml] Training LogisticRegression (baseline) ...")
    # multi_class="multinomial" is deprecated/removed in newer scikit-learn —
    # omitted here; LogisticRegression uses multinomial loss automatically
    # with the default 'lbfgs' solver for a problem with >2 classes.
    lr = LogisticRegression(max_iter=2000)
    models_results["LogisticRegression"], predictions["LogisticRegression"] = evaluate(
        "LogisticRegression", lr, X_train_scaled, X_test_scaled, y_train, y_test, class_names
    )

    best_name = max(models_results, key=lambda n: models_results[n]["f1"])
    best_model = {"RandomForest": rf, "GradientBoosting": gb, "LogisticRegression": lr}[best_name]
    y_pred_best = predictions[best_name]
    cm = confusion_matrix(y_test, y_pred_best).tolist()

    feature_importance = []
    if hasattr(best_model, "feature_importances_"):
        feature_importance = sorted(
            [
                {"feature": f, "importance": round(float(imp), 4)}
                for f, imp in zip(feature_cols, best_model.feature_importances_)
            ],
            key=lambda x: x["importance"],
            reverse=True,
        )

    output = {
        "modelsCompared": models_results,
        "bestModel": best_name,
        "classes": class_names,
        "confusionMatrix": cm,
        "featureImportance": feature_importance,
        "trainedOn": {
            "totalRows": len(df),
            "trainRows": len(X_train),
            "testRows": len(X_test),
            "features": feature_cols,
            "droppedClasses": sorted(dropped),
        },
    }

    output_path = BACKEND_DIR / "data" / "model-metrics.json"
    output_path.parent.mkdir(exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2))

    print(f"[ml] Best model: {best_name} (F1={models_results[best_name]['f1']:.3f})")
    print(f"[ml] Wrote {output_path}")


if __name__ == "__main__":
    main()
