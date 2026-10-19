"""Honest evaluation: macro-F1 first, per-class results with support, never accuracy alone."""

from __future__ import annotations

import time

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    matthews_corrcoef,
    precision_recall_fscore_support,
)
from sklearn.preprocessing import label_binarize

UNSTABLE_SUPPORT = 30


def _num(x: float | None) -> float | None:
    if x is None or not np.isfinite(x):
        return None
    return round(float(x), 4)


def evaluate(model, X, y_true, classes: list[str]) -> dict:
    """Metrics on a held-out set. `classes` is the model's class order."""
    t0 = time.perf_counter()
    proba = model.predict_proba(X)
    elapsed = time.perf_counter() - t0
    y_pred = np.asarray(classes)[proba.argmax(axis=1)]
    y_true = np.asarray(y_true)

    present = [c for c in classes if (y_true == c).any() or (y_pred == c).any()]
    p, r, f, s = precision_recall_fscore_support(y_true, y_pred, labels=present, zero_division=0)
    per_class = []
    y_bin = label_binarize(y_true, classes=classes) if len(classes) > 2 else None
    for i, c in enumerate(present):
        support = int(s[i])
        ci = classes.index(c)
        if y_bin is not None:
            col = y_bin[:, ci]
        else:
            col = (y_true == c).astype(int)
        pr_auc = average_precision_score(col, proba[:, ci]) if support > 0 and col.sum() < len(col) else None
        per_class.append(
            {
                "label": c,
                "precision": _num(p[i]) if (y_pred == c).any() else None,
                "recall": _num(r[i]) if support else None,
                "f1": _num(f[i]) if support else None,
                "support": support,
                "prAuc": _num(pr_auc) if pr_auc is not None else None,
                "unstable": support < UNSTABLE_SUPPORT,
            }
        )
    supported = [c for c in present if (y_true == c).any()]
    conf = proba.max(axis=1)
    correct = y_pred == y_true
    bins = np.linspace(0, 1, 11)
    reliability = []
    ece = 0.0
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            acc, mean_conf = float(correct[m].mean()), float(conf[m].mean())
            ece += m.mean() * abs(acc - mean_conf)
            reliability.append({"bin": [round(lo, 1), round(hi, 1)], "count": int(m.sum()), "accuracy": round(acc, 4), "confidence": round(mean_conf, 4)})
    return {
        "macroF1": _num(f1_score(y_true, y_pred, labels=supported, average="macro", zero_division=0)),
        "weightedF1": _num(f1_score(y_true, y_pred, labels=supported, average="weighted", zero_division=0)),
        "mcc": _num(matthews_corrcoef(y_true, y_pred)),
        # Reported for completeness only; never shown without macro-F1 and per-class results.
        "accuracy": _num(float(correct.mean())),
        "testRows": int(len(y_true)),
        "perClass": per_class,
        "confusionMatrix": {"labels": present, "matrix": confusion_matrix(y_true, y_pred, labels=present).tolist()},
        "calibration": {"ece": _num(ece), "reliability": reliability},
        "latencyMsPer1000": _num(elapsed / max(len(y_true), 1) * 1000 * 1000),
    }


def min_recall(metrics: dict, classes: list[str]) -> float | None:
    values = [c["recall"] for c in metrics["perClass"] if c["label"] in classes and c["recall"] is not None]
    return min(values) if values else None
