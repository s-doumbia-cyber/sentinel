"""Inference API (docs/ML_AND_DETECTION.md §5)."""

from __future__ import annotations

import hmac
import math
import os
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .registry import Registry, VersionMismatch
from .schemas import feature_names

MAX_FLOWS = 1000
EXPLAIN_BELOW_CONFIDENCE = 0.6


class FlowIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    features: dict[str, float | None]


class PredictRequest(BaseModel):
    schema_id: str = Field(alias="schema")
    modelVersion: str
    flows: list[FlowIn] = Field(min_length=1, max_length=MAX_FLOWS)
    explain: bool = False

    model_config = {"populate_by_name": True}


def create_app(artifacts_dir: Path | None = None, token: str | None = None) -> FastAPI:
    artifacts = artifacts_dir or Path(os.environ.get("SENTINEL_ARTIFACTS_DIR", Path(__file__).resolve().parents[1] / "artifacts"))
    token = token if token is not None else os.environ.get("SENTINEL_ML_TOKEN") or None
    registry = Registry(artifacts)
    app = FastAPI(title="Sentinel ML", version="0.1.0")
    app.state.registry = registry

    def check_token(x_internal_token: str | None = Header(default=None)) -> None:
        if token and not (x_internal_token and hmac.compare_digest(x_internal_token, token)):
            raise HTTPException(status_code=401, detail="Invalid internal token")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "models": len(registry.models)}

    @app.get("/models", dependencies=[Depends(check_token)])
    def list_models() -> dict:
        return {"models": [m.summary() for m in registry.models.values()]}

    @app.get("/models/{version}", dependencies=[Depends(check_token)])
    def get_model(version: str) -> dict:
        entry = registry.get(version)
        if not entry:
            raise HTTPException(status_code=404, detail=f"Unknown model version {version}")
        card = (entry.path / "model_card.md").read_text(encoding="utf-8") if (entry.path / "model_card.md").is_file() else None
        return {**entry.summary(), "modelCard": card}

    @app.post("/reload", dependencies=[Depends(check_token)])
    def reload() -> dict:
        return {"models": registry.reload()}

    @app.post("/predict", dependencies=[Depends(check_token)])
    def predict(req: PredictRequest) -> dict:
        entry = registry.get(req.modelVersion)
        if not entry:
            raise HTTPException(status_code=404, detail=f"Unknown model version {req.modelVersion}")
        if entry.schema != req.schema_id:
            # Never score a flow with a model of another feature schema.
            raise HTTPException(status_code=409, detail=f"Schema mismatch: model {entry.version} expects {entry.schema}, got {req.schema_id}")
        try:
            bundle = entry.bundle()
        except VersionMismatch as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        names = feature_names(entry.schema)
        expected = set(names)
        for f in req.flows:
            keys = set(f.features)
            if keys != expected:
                missing, unknown = sorted(expected - keys), sorted(keys - expected)
                raise HTTPException(
                    status_code=422,
                    detail=f"Flow {f.id}: missing features {missing[:10]} unknown features {unknown[:10]}",
                )
        rows = [[np.nan if (v is None or not math.isfinite(v)) else v for v in (f.features[n] for n in names)] for f in req.flows]
        X = pd.DataFrame(rows, columns=names, dtype="float64")
        pipeline, classes = bundle["pipeline"], bundle["classes"]
        proba = pipeline.predict_proba(X)
        best = proba.argmax(axis=1)
        results = []
        for i, f in enumerate(req.flows):
            results.append(
                {
                    "id": f.id,
                    "label": classes[best[i]],
                    "confidence": round(float(proba[i, best[i]]), 6),
                    "probabilities": {c: round(float(p), 6) for c, p in zip(classes, proba[i])},
                }
            )
        if req.explain:
            # Cost control: explain only non-benign or low-confidence verdicts.
            idx = [i for i, r in enumerate(results) if r["label"] != "Normal" or r["confidence"] < EXPLAIN_BELOW_CONFIDENCE]
            if idx:
                tops = entry.explainer().top(X.iloc[idx].reset_index(drop=True), best[idx])
                for i, top in zip(idx, tops):
                    results[i]["topFeatures"] = top
        return {"modelVersion": entry.version, "schema": entry.schema, "results": results}

    return app
