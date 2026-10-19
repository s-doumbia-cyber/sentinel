"""Model registry: scans the artefact directory; loads models lazily."""

from __future__ import annotations

import json
import logging
import os
import platform
import threading
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn

from .explain import Explainer

log = logging.getLogger("sentinel_ml.registry")


class VersionMismatch(RuntimeError):
    pass


def runtime_versions() -> dict[str, str]:
    return {"python": platform.python_version(), "scikit-learn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__}


def _minor(v: str) -> str:
    return ".".join(v.split(".")[:2])


def version_warnings(stored: dict[str, str]) -> tuple[list[str], bool]:
    """Returns (warnings, blocking). A scikit-learn minor-version change blocks loading (pickles are version-sensitive)."""
    warnings, blocking = [], False
    for lib, now in runtime_versions().items():
        then = stored.get(lib)
        if then and then != now:
            warnings.append(f"{lib} {then} at training, {now} at runtime")
            if lib == "scikit-learn" and _minor(then) != _minor(now):
                blocking = True
    return warnings, blocking


@dataclass
class ModelEntry:
    path: Path
    meta: dict
    warnings: list[str] = field(default_factory=list)
    blocking: bool = False
    _bundle: dict | None = None
    _explainer: Explainer | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def version(self) -> str:
        return self.meta["version"]

    @property
    def schema(self) -> str:
        return self.meta["schema"]

    def summary(self) -> dict:
        return {**self.meta, "versionWarnings": self.warnings, "loadBlocked": self.blocking}

    def bundle(self) -> dict:
        if self.blocking and os.environ.get("SENTINEL_ALLOW_VERSION_MISMATCH") != "1":
            raise VersionMismatch(f"Model {self.version} refused: " + "; ".join(self.warnings) + ". Retrain it in this environment.")
        with self._lock:
            if self._bundle is None:
                self._bundle = joblib.load(self.path / "model.joblib")
            return self._bundle

    def explainer(self) -> Explainer:
        with self._lock:
            if self._explainer is None:
                bundle = self._bundle if self._bundle is not None else joblib.load(self.path / "model.joblib")
                self._bundle = bundle
                self._explainer = Explainer(bundle["pipeline"], bundle["features"])
            return self._explainer


class Registry:
    def __init__(self, artifacts_dir: Path):
        self.dir = artifacts_dir
        self.models: dict[str, ModelEntry] = {}
        self.reload()

    def reload(self) -> int:
        models: dict[str, ModelEntry] = {}
        if self.dir.is_dir():
            for meta_path in sorted(self.dir.glob("*/meta.json")):
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    metrics_path = meta_path.parent / "metrics.json"
                    if "groupAware" not in meta and metrics_path.is_file():
                        # Surface the leakage check next to the headline numbers, not only in the card.
                        g = json.loads(metrics_path.read_text(encoding="utf-8")).get("groupAware", {})
                        meta["groupAware"] = {k: g.get(k) for k in ("status", "reason", "macroF1", "testRows", "groups", "perClass", "classesMissingFromTest", "classesMissingFromTrain") if k in g}
                    warnings, blocking = version_warnings(meta.get("libVersions", {}))
                    entry = ModelEntry(meta_path.parent, meta, warnings, blocking)
                    models[entry.version] = entry
                    if warnings:
                        log.warning("Model %s: %s", entry.version, "; ".join(warnings))
                except (OSError, ValueError, KeyError) as exc:
                    log.error("Skipping unreadable artefact %s: %s", meta_path.parent.name, exc)
        self.models = models
        return len(models)

    def get(self, version: str) -> ModelEntry | None:
        return self.models.get(version)
