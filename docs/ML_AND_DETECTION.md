# Sentinel — ML and Detection Specification

## 1. Goals

1. Turn the ML work into a **served, versioned, explainable** detector, not an offline report.
2. Validate on **traffic the owner captured in their own lab**, not only on CICIDS2017.
3. Report honestly: macro-F1, per-class results, support, limits.

## 2. Two feature schemas, two model families

CICIDS2017 features come from CICFlowMeter. A live collector built on another flow extractor (e.g. nfstream) produces *similar but not identical* statistics. Pretending they are interchangeable would silently break the model. So:

| Schema id | Produced by | Used for | Model family |
|---|---|---|---|
| `cicids2017-v1` | CICFlowMeter-style columns from CSV imports | Imported datasets, benchmark, replay of CICIDS data | **Benchmark model** |
| `sentinel-native-v1` | Sentinel collector (defined by us) | Live and PCAP traffic | **Lab model** |

Rules:
- Every flow carries `featureSchema`. The ML service routes each flow to the active model **with the same schema**. A flow with no matching active model is stored unscored and flagged (never scored by a mismatched model).
- `feature_schema.json` (name, order, dtype, unit, missing-value policy) is versioned and saved with each model.
- The collector includes unit tests that compute each native feature on a known PCAP and compare to expected values.

### `sentinel-native-v1` starting feature set (collector-defined)
Duration; fwd/bwd packet counts; fwd/bwd byte totals; mean/std/min/max packet length; packets/s; bytes/s; mean/std/max inter-arrival time (flow, fwd, bwd); TCP flag counts (SYN, ACK, FIN, RST, PSH, URG); initial window sizes; bidirectional ratio; protocol; dst-port class (well-known / registered / ephemeral). Final list is decided in Phase 2 and frozen as `v1`.

## 3. Attack taxonomy and severity (in `packages/shared`)

Canonical classes: `Normal, DDoS, DoSHulk, DoSSlowloris, DoSGoldenEye, FTPPatator, SSHPatator, PortScan, Botnet, Infiltration, WebAttack, XSS, SQLInjection, Heartbleed` (+ lab classes as added). Label normalisation is a pure, unit-tested function: unknown input returns `null` (caller skips and logs).

Default severity (configurable per org): `critical`: DDoS, Botnet, Heartbleed · `high`: DoSHulk, DoSGoldenEye, SQLInjection, WebAttack, XSS, Infiltration · `medium`: DoSSlowloris, FTPPatator, SSHPatator · `low`: PortScan.

### MITRE ATT&CK mapping (always displayed as "suggested")
| Class | Technique |
|---|---|
| PortScan | T1046 Network Service Discovery (TA0007) |
| FTPPatator, SSHPatator | T1110 Brute Force (TA0006) |
| DDoS | T1498 Network Denial of Service (TA0040) |
| DoSHulk, DoSSlowloris, DoSGoldenEye | T1499 Endpoint Denial of Service (TA0040) |
| WebAttack, XSS, SQLInjection, Heartbleed | T1190 Exploit Public-Facing Application (TA0001) |
| Botnet | T1071 Application Layer Protocol (TA0011) |
| Infiltration | No single technique; show tactic context (lateral movement TA0008 / exfiltration TA0010) as a hint only |

## 4. Training pipeline v2 (`services/ml`)

**CLI:** `sentinel-train --config configs/cicids.yaml` (and `configs/lab.yaml`).

1. **Data:** read from Mongo (via `$sample` or stratified queries, never `.limit()` on natural order) or from Parquet exports. Record dataset ids, row counts, class counts.
2. **Cleaning:** drop duplicates; coerce inf/NaN (policy documented); resolve CICIDS duplicate columns; remove identifier-like columns that leak (IPs, flow ids, timestamps).
3. **Splits:** stratified train/val/test with fixed seed. Also report a **group-aware split** (group by source IP and time bucket) and, for lab data, a **time-based holdout** to expose leakage. Report all.
4. **Imbalance study:** compare `class_weight="balanced"`, SMOTE (imbalanced-learn, optional), and threshold tuning. Keep the best, but report all.
5. **Models:** Logistic Regression (baseline), Random Forest, HistGradientBoosting (sklearn, no extra dependency); LightGBM/XGBoost optional if justified; small MLP optional.
6. **Metrics (per model, on the untouched test set):** macro-F1 (primary), weighted-F1, per-class precision/recall/F1/support, per-class PR-AUC, MCC, confusion matrix, calibration curve (reliability), latency per 1,000 flows, artefact size.
7. **Selection:** highest macro-F1 subject to a minimum recall on `critical` classes; tie → lower latency.
8. **Artefacts** (directory per version): `model.joblib`, `feature_schema.json`, `metrics.json`, `model_card.md`, `training_config.yaml`, `SHA256SUMS`, `env.json` (python, sklearn, numpy versions).
9. **Registry:** register in Mongo `models` as `candidate`. Activation is an Admin action in the UI.

## 5. Serving contract (FastAPI)

```
GET  /health
GET  /models                      → list (schema, version, status)
POST /predict
  request : { "schema": "sentinel-native-v1",
              "flows": [ { "id": "...", "features": { "<name>": number, ... } } ],
              "explain": false }
  response: { "modelVersion": "lab-2026.10.1",
              "results": [ { "id": "...", "label": "PortScan",
                             "confidence": 0.93,
                             "probabilities": { "PortScan": 0.93, "Normal": 0.05, ... },
                             "topFeatures": [ { "name": "Flow Packets/s", "contribution": 0.21,
                                                "value": 812.4 } ] } ] }
POST /reload                      → reload active models (called after activation)
```
- Validate features against `feature_schema.json`: reject unknown/missing features with a precise error.
- On startup, compare stored library versions with the runtime; log a warning and expose it in `/models` if they differ.
- Batch endpoint is vectorised; target ≥ 5,000 flows/s without explanations on a laptop.

## 6. Explainability

- Use SHAP `TreeExplainer` for tree models; for linear models use coefficient × standardised value. Return the **top 5** signed contributions for the predicted class.
- UI shows them as a diverging bar chart with plain-language labels from a `featureGlossary.json` (e.g. "Packets per second: very high versus normal traffic"). Add a unit test that contributions plus base value reconstruct the model output within tolerance.
- Explanations are computed only for non-benign or low-confidence flows (cost control).
- Always show: model version, schema, confidence, and "explanations describe the model, not causes".

## 7. Rules engine

Rules complement the model (they catch what the model was not trained on, and give analysts control).

**Definition (JSON, editable in the UI):**
```json
{ "key": "R-PORTSCAN-01", "name": "Horizontal/vertical port scan",
  "type": "threshold", "window": "60s", "groupBy": ["srcIp"],
  "condition": { "distinct": "dstPort", "gte": 100 }, "filter": { "maxPacketsPerFlow": 3 },
  "severity": "low", "alertType": "PortScan", "enabled": true }
```
Starter rules: port scan (distinct dst ports), SSH/FTP brute force (many short flows to port 22/21 from one source), SYN flood (SYN-dominant flows at high rate to one destination), HTTP slow-request pattern (many long, low-rate flows to 80/443).

- Evaluated per ingest batch with a sliding window kept in Redis.
- `POST /rules/:id/test` replays the rule over a chosen time range and shows would-be hits (no alerts created).
- Hybrid result: severity = max(model, rule); alert `sources` lists everything that fired.

## 8. Confidence, unknowns and novelty

- Confidence below the org threshold (default 0.6) → alert status `needs_review` (never a hard verdict).
- Stretch: an IsolationForest trained on benign lab traffic produces a `novelty` score. High novelty with low class confidence → "Unknown behaviour" alert. Report its false-positive rate in the model card.

## 9. Drift and feedback

- **Drift:** daily job computes PSI per feature between the training distribution and the last 24 h of live flows; also tracks predicted-class distribution. PSI > 0.2 raises a "model drift" notification.
- **Feedback loop:** analyst verdicts (true positive / false positive / benign) are stored. "Export labelled data" produces a dataset for retraining. The Models lab shows false-positive rate by class and the number of analyst-labelled examples.
- Never auto-retrain or auto-activate. Retraining is a deliberate Admin workflow.

## 10. Model card template (auto-generated per version)

1. Model name, version, schema, date, library versions, SHA256.
2. Intended use and out-of-scope use.
3. Training data (sources, size, class counts, collection dates).
4. Evaluation: macro-F1, per-class table with support, confusion matrix, calibration.
5. **Cross-dataset results**: CICIDS→lab and lab→lab (honest table, even when poor).
6. Known limitations (tiny-support classes, label-quality issues, domain shift, 2017 testbed).
7. Ethical and operational notes (human in the loop; no automatic blocking).

## 11. Lab dataset collection protocol

**Only on a network you own, isolated from other networks (host-only or internal VMware network).** Never run these tools against third-party systems.

**Topology:** Kali attacker VM · Ubuntu server VM (SSH, FTP, HTTP, DVWA) · optional Windows VM · "benign user" VM · Sentinel collector on the monitoring interface (or the host's virtual adapter).

**Benign traffic generators:** scripted browsing (headless browser), `curl` loops, file transfers (SFTP/FTP), DNS queries, SSH sessions with normal commands, package updates. Run for several hours across varied times.

**Attack scripts (`lab/attacks/`)**, each appends a row to `lab/attack_runs.csv` (`start_utc,end_utc,attacker_ip,target_ip,class,tool,params`):
- PortScan: `nmap -sS`, `-sV`, `-p-` with varied timing templates.
- SSH/FTP brute force: `hydra` with a small wordlist, varied rates.
- DoS/flood: `hping3` SYN flood at a limited rate; `slowhttptest` for Slowloris-style behaviour.
- Web attacks: `sqlmap` and manual XSS payloads against DVWA on the lab server.
- (Optional) Botnet-like beaconing: a small script that calls a lab "C2" endpoint at jittered intervals.

**Labelling:** automatic. A flow is labelled with the class of any attack run whose time window and (attacker, target) pair match; everything else in clean windows is `Normal`. Ambiguous overlaps are excluded and counted.

**Targets:** ≥ 50,000 benign flows; ≥ 2,000 flows per attack class; multiple parameter variants per attack; hold out entire *runs* (not random rows) for testing to avoid leakage.

**Reporting:** dataset card (collection dates, topology, tools/versions, counts, exclusions). Publish aggregate stats; do not publish raw captures containing real credentials.

## 12. Honesty rules (enforced in code review)

1. Never show accuracy alone. Always macro-F1 and per-class with support.
2. Classes with fewer than ~30 test examples are marked "unstable estimate" in the UI.
3. The UI states the model's training data and that a model trained on one network may not generalise to another.
4. `REPLAY` traffic never appears as `LIVE`.
5. If the active model's schema does not match incoming flows, say so; do not score.
6. Benchmark numbers (CICIDS2017) are labelled "benchmark", separate from lab results.
