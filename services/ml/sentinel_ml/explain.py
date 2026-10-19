"""Per-flow explanations (docs/ML_AND_DETECTION.md §6).

Tree models: SHAP TreeExplainer on the imputed features. Linear models:
coefficient x standardised value. Contributions are in the model's output
space (probability for random forests, log-odds / logits otherwise) and, with
the base value, add up to that output. They describe the model, not causes.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

TOP_K = 5


def _as_nfk(values, n_classes: int) -> np.ndarray:
    arr = np.stack(values, axis=-1) if isinstance(values, list) else np.asarray(values)
    if arr.ndim == 2:
        # Binary model with a single output for the positive class.
        arr = np.stack([-arr, arr], axis=-1)
    if arr.shape[-1] != n_classes:
        raise ValueError(f"Unexpected explanation shape {arr.shape} for {n_classes} classes")
    return arr


def _base_per_class(expected, n_classes: int) -> np.ndarray:
    ev = np.atleast_1d(np.asarray(expected, dtype=float))
    if ev.size == 1 and n_classes == 2:
        ev = np.array([-ev[0], ev[0]])
    return ev


class Explainer:
    """Wraps a fitted Pipeline whose last step is the estimator."""

    def __init__(self, pipeline: Pipeline, feature_names: list[str]):
        self.pipeline = pipeline
        self.features = feature_names
        self.estimator = pipeline.steps[-1][1]
        self.pre = pipeline[:-1]
        self.n_classes = len(self.estimator.classes_)
        if isinstance(self.estimator, LogisticRegression):
            self.kind = "linear"
            self.output_space = "logit"
            self._tree = None
        else:
            import shap  # imported lazily: heavy, and only needed when explaining

            self.kind = "tree-shap"
            self._tree = shap.TreeExplainer(self.estimator)
            self.output_space = "probability" if hasattr(self.estimator, "estimators_") else "log-odds"

    def contributions(self, X: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        """Full matrix (n, features, classes) and base values (classes,)."""
        Xt = np.asarray(self.pre.transform(X), dtype=float)
        if self.kind == "linear":
            coef = np.atleast_2d(self.estimator.coef_)
            intercept = np.atleast_1d(self.estimator.intercept_)
            contrib = Xt[:, :, None] * coef.T[None, :, :]
            if coef.shape[0] == 1:  # binary: one logit for the positive class
                contrib = np.concatenate([-contrib, contrib], axis=-1)
                intercept = np.array([-intercept[0], intercept[0]])
            return contrib, intercept
        assert self._tree is not None
        values = self._tree.shap_values(Xt, check_additivity=False)
        return _as_nfk(values, self.n_classes), _base_per_class(self._tree.expected_value, self.n_classes)

    def model_output(self, X: pd.DataFrame) -> np.ndarray:
        """The quantity the contributions add up to, per class (for tests and audits)."""
        if self.output_space == "probability":
            return self.pipeline.predict_proba(X)
        raw = self.pipeline.decision_function(X)
        raw = np.asarray(raw, dtype=float)
        if raw.ndim == 1:
            raw = np.stack([-raw, raw], axis=-1)
        return raw

    def top(self, X: pd.DataFrame, class_idx: np.ndarray, k: int = TOP_K) -> list[list[dict]]:
        contrib, _ = self.contributions(X)
        out = []
        raw_values = X.to_numpy(dtype=float)
        for i, ci in enumerate(class_idx):
            row = contrib[i, :, ci]
            order = np.argsort(-np.abs(row))[:k]
            out.append(
                [
                    {
                        "name": self.features[j],
                        "contribution": round(float(row[j]), 6),
                        # The original value; null when it was missing and imputed.
                        "value": None if not np.isfinite(raw_values[i, j]) else float(raw_values[i, j]),
                    }
                    for j in order
                    if row[j] != 0
                ]
            )
        return out
