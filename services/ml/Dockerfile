# Pinned Python: model artefacts record library versions and the registry
# refuses a scikit-learn minor-version mismatch, so train and serve in this image.
FROM python:3.12-slim
WORKDIR /app
# OMP_NUM_THREADS=1: OpenMP worker threads busy-spun forever after the model
# selection step when combined with joblib's process pool in this image.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SENTINEL_FEATURE_SCHEMAS_DIR=/app/feature-schemas \
    SENTINEL_ARTIFACTS_DIR=/app/artifacts \
    OMP_NUM_THREADS=1
COPY services/ml/pyproject.toml ./
COPY services/ml/sentinel_ml ./sentinel_ml
RUN pip install --no-cache-dir . && useradd --create-home sentinel
COPY packages/shared/src/feature-schemas ./feature-schemas
COPY services/ml/configs ./configs
# Small labelled sample so the benchmark model can be trained inside this image.
COPY data/samples ./samples
RUN mkdir -p /app/artifacts && chown -R sentinel /app/artifacts
USER sentinel
EXPOSE 8000
CMD ["sentinel-ml-serve", "--host", "0.0.0.0", "--port", "8000"]
