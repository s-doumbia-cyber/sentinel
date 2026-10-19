This folder holds generated artifacts that shouldn't be committed to git:

- `model-metrics.json` — written by `python ml/train_model.py`, served at GET /api/ml/metrics.

It's created automatically the first time you run the training script.
