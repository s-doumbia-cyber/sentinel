"""Optional novelty detector (docs/ML_AND_DETECTION.md §8, roadmap 5.7).

An IsolationForest fitted on BENIGN training rows only. A high score means "far
from the benign traffic the model learned", which is not a diagnosis: it is never
mapped to an attack class. Every real attack is also unusual compared with
benign traffic, so the consumer (apps/api) calls a flow "unusual behaviour" only
when the score is above the threshold AND the classifier did not recognise it
with confidence. The threshold is a quantile of the benign training scores, so
the benign false-positive rate is about `1 - quantile` by construction; the
measured rate on held-out benign rows is reported next to it.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

NOVELTY_FILE = "novelty.joblib"
DEFAULT_QUANTILE = 0.99
MIN_BENIGN_ROWS = 50
BENIGN_LABEL = "Normal"


class NoveltyModel:
    """Scores rows in [0, 1]-ish units where higher means more unusual (`-score_samples`)."""

    def __init__(self, pipeline: Pipeline, threshold: float, quantile: float, rows: int):
        self.pipeline = pipeline
        self.threshold = threshold
        self.quantile = quantile
        self.rows = rows

    def score(self, X: pd.DataFrame) -> np.ndarray:
        Xt = self.pipeline[:-1].transform(X)
        return -self.pipeline[-1].score_samples(Xt)


def fit_novelty(X_benign: pd.DataFrame, seed: int, quantile: float = DEFAULT_QUANTILE) -> NoveltyModel:
    if not 0.5 <= quantile < 1:
        raise ValueError("novelty.quantile must be in [0.5, 1)")
    if len(X_benign) < MIN_BENIGN_ROWS:
        raise ValueError(f"Novelty needs at least {MIN_BENIGN_ROWS} benign rows; found {len(X_benign)}")
    pipe = Pipeline(
        [
            ("impute", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("scale", StandardScaler()),
            ("forest", IsolationForest(n_estimators=100, random_state=seed, n_jobs=1)),
        ]
    )
    pipe.fit(X_benign)
    model = NoveltyModel(pipe, 0.0, quantile, int(len(X_benign)))
    model.threshold = float(np.quantile(model.score(X_benign), quantile))
    return model


def evaluate_novelty(model: NoveltyModel, X: pd.DataFrame, y: pd.Series) -> dict:
    """On the untouched test rows: how often benign is flagged, and how much of each attack class is."""
    flagged = model.score(X) >= model.threshold
    y_arr = np.asarray(y)
    benign = y_arr == BENIGN_LABEL
    per_class = []
    for c in sorted(set(y_arr.tolist()) - {BENIGN_LABEL}):
        m = y_arr == c
        per_class.append({"label": c, "support": int(m.sum()), "flaggedShare": round(float(flagged[m].mean()), 4)})
    return {
        "benignRows": int(benign.sum()),
        "benignFalsePositiveRate": round(float(flagged[benign].mean()), 4) if benign.any() else None,
        "perClass": per_class,
    }
