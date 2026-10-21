"""Whole-group holdout (docs/ML_AND_DETECTION.md §4.3): test on days / files / a column the model never saw.

A random split puts neighbouring flows of the same capture on both sides, which
inflates scores. Holding out whole groups (for CICIDS2017: capture days, one CSV
file each) is the check that exposes it. With a holdout configured, the shipped
model is trained WITHOUT the held-out groups, so the held-out numbers describe
the shipped model itself.
"""

from __future__ import annotations

import fnmatch

import numpy as np
import pandas as pd

from .metrics import evaluate

DEFAULT_FRACTION = 0.25


def parse_holdout_config(cfg: dict | None) -> dict | None:
    """Validates `split.holdout`; returns None when no holdout is configured."""
    if not cfg:
        return None
    by = str(cfg.get("by", "file")).strip()
    if not by or by.lower() == "none":
        return None
    groups = cfg.get("groups")
    if groups is not None and (not isinstance(groups, list) or not all(isinstance(g, str) and g for g in groups)):
        raise ValueError("split.holdout.groups must be a list of group names or glob patterns")
    fraction = float(cfg.get("fraction", DEFAULT_FRACTION))
    if not 0 < fraction < 1:
        raise ValueError("split.holdout.fraction must be between 0 and 1")
    return {"by": "file" if by.lower() == "file" else by, "groups": groups, "fraction": fraction}


def select_holdout_groups(values: pd.Series, patterns: list[str] | None, fraction: float, seed: int) -> list[str]:
    """Picks the groups to hold out: explicit names / globs, else a seeded fraction of the groups."""
    all_groups = sorted(values.unique().tolist())
    if len(all_groups) < 2:
        raise ValueError(f"Holding out needs at least two groups; found {all_groups}")
    if patterns:
        chosen = sorted(g for g in all_groups if any(fnmatch.fnmatchcase(g, p) for p in patterns))
        unmatched = [p for p in patterns if not any(fnmatch.fnmatchcase(g, p) for g in all_groups)]
        if unmatched:
            # A typo would otherwise silently shrink the test set.
            raise ValueError(f"Holdout pattern(s) {unmatched} match none of the groups {all_groups}")
    else:
        n = max(1, round(len(all_groups) * fraction))
        rng = np.random.default_rng(seed)
        chosen = sorted(rng.choice(all_groups, size=n, replace=False).tolist())
    if len(chosen) >= len(all_groups):
        raise ValueError("Every group is held out: nothing is left to train on")
    return chosen


def evaluate_holdout(
    model,
    model_classes: list[str],
    X: pd.DataFrame,
    y: pd.Series,
    groups: pd.Series,
    *,
    by: str,
    held_groups: list[str],
    train_classes: list[str],
    train_rows: int,
) -> dict:
    """Per-class metrics of the shipped model on the held-out groups, with explicit warnings."""
    held_classes = sorted(y.unique().tolist())
    known = [c for c in held_classes if c in model_classes]
    unseen = [c for c in held_classes if c not in model_classes]
    absent_from_holdout = sorted(c for c in train_classes if c not in held_classes)
    warnings = []
    if absent_from_holdout:
        warnings.append(
            f"Classes with no rows in the held-out groups, so no estimate exists for them: {', '.join(absent_from_holdout)}."
        )
    if unseen:
        warnings.append(
            f"Classes present only in the held-out groups, never seen in training: {', '.join(unseen)}. "
            "The model cannot predict them; their rows are excluded from the table below."
        )
    base = {
        "by": by,
        "groups": held_groups,
        "trainRows": int(train_rows),
        "rows": int(len(y)),
        "classesMissingFromHoldout": absent_from_holdout,
        "classesUnseenInTraining": unseen,
        "warnings": warnings,
    }
    keep = y.isin(model_classes).to_numpy()
    if not keep.any():
        return {**base, "status": "not_possible", "reason": "no held-out row has a class the model knows"}
    Xk, yk = X[keep].reset_index(drop=True), y[keep].reset_index(drop=True)
    gk = groups[keep].reset_index(drop=True)
    m = evaluate(model, Xk, yk, model_classes)
    per_group = []
    for g in held_groups:
        sel = (gk == g).to_numpy()
        if not sel.any():
            continue
        gm = evaluate(model, Xk[sel].reset_index(drop=True), yk[sel].reset_index(drop=True), model_classes)
        per_group.append(
            {
                "group": g,
                "rows": int(sel.sum()),
                "classes": {str(k): int(v) for k, v in yk[sel].value_counts().sort_index().items()},
                "macroF1": gm["macroF1"],
            }
        )
    return {
        **base,
        "status": "ok",
        "rowsScored": int(keep.sum()),
        "rowsExcludedUnseenClass": int((~keep).sum()),
        "macroF1": m["macroF1"],
        "weightedF1": m["weightedF1"],
        "testRows": m["testRows"],
        "perClass": m["perClass"],
        "perGroup": per_group,
    }
