# services/ml

FastAPI inference service, model registry and training CLI for Sentinel.

## Setup (Windows PowerShell or Linux/macOS)

From the repository root:

```bash
npm run ml:install        # creates services/ml/.venv and installs the package with dev extras
npm run ml:train:sample   # trains the benchmark model on data/samples (writes services/ml/artifacts/<version>/)
npm run ml:serve          # http://127.0.0.1:8000 (set SENTINEL_ML_TOKEN to require X-Internal-Token)
npm run ml:test           # pytest
```

Python 3.11+ is required. The Docker image pins Python 3.12; train inside the image
(`docker compose --profile train run --rm ml-train`) when serving from Docker, because the
registry refuses a model whose scikit-learn minor version differs from the runtime.

## Training on the full CICIDS2017 dataset

Copy the day files into `data/cicids2017/` (git-ignored), or keep them where they are and pass
`--csv "<folder>/*.csv"`. Both the MachineLearningCVE and the TrafficLabelling (with IPs) versions
train; only the TrafficLabelling version can also be imported into Sentinel as flows. A checked run
on the full download is described in `docs/WINDOWS_GUIDE.md` §8. Then:

```bash
services/ml/.venv/Scripts/python -m sentinel_ml.train --config services/ml/configs/cicids-full.example.yaml   # Windows
services/ml/.venv/bin/python -m sentinel_ml.train --config services/ml/configs/cicids-full.example.yaml       # Linux/macOS
```

`--csv <path-or-glob>` (repeatable) and `--output-dir` override the config.

## What a training run produces

`artifacts/<version>/`: `model.joblib`, `feature_schema.json`, `metrics.json`, `model_card.md`,
`training_config.yaml` (effective), `env.json` (library versions), `meta.json`, `SHA256SUMS`.

- Splits: stratified train / validation / test (seed in the config) plus a group-aware holdout
  by source IP to expose leakage.
- Candidates: logistic regression, random forest, HistGradientBoosting, each with and without
  `class_weight="balanced"`. Selection: best validation macro-F1 among candidates whose recall on
  critical classes (DDoS, Botnet, Heartbleed) reaches the configured floor; ties go to lower latency.
- Reported on the untouched test set: macro-F1, weighted-F1, MCC, per-class precision / recall /
  F1 / PR-AUC / support (classes under 30 test rows flagged unstable), confusion matrix,
  calibration (ECE + reliability bins), latency per 1,000 flows.
- Unknown labels are dropped and counted; non-finite values are imputed with the training median.
- Nothing is activated automatically.

Not done yet (ROADMAP 1.3): reading training data from MongoDB, SMOTE and threshold-tuning
comparisons, time-based holdout for lab data, cross-dataset evaluation.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | public |
| GET | `/models` | registry summary, version warnings, group-aware holdout |
| GET | `/models/{version}` | plus the model card |
| POST | `/predict` | `{schema, modelVersion, flows:[{id, features}], explain}`; missing or unknown features → 422; schema mismatch → 409; version mismatch → 409 |
| POST | `/reload` | rescan artefacts (also happens automatically) |

Explanations (top 5 signed contributions for the predicted class) are computed only for
non-benign or low-confidence verdicts: SHAP `TreeExplainer` for tree models (probability space
for random forests, log-odds for gradient boosting), coefficient × standardised value for
logistic regression. Tests check that contributions plus the base value reconstruct the model
output within 1e-4. They describe the model, not the cause of an attack.
