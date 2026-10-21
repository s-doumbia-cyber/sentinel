# Sentinel — Evaluation report

> What was measured, on what data, and what the numbers do and do not show. Every figure below comes
> from a run on the owner's machine between 2026-10-19 and 2026-10-22; nothing is estimated. Read
> §5 before quoting any number.

## 1. Detection model on CICIDS2017 (benchmark)

**Model** `cicids-bench-2026.10.20-111101` · schema `cicids2017-v1` (44 CICFlowMeter features) ·
histogram gradient boosting, balanced class weights · trained 2026-10-20 on the eight
`*.pcap_ISCX.csv` day files (*TrafficLabelling* version) · Python 3.14.6, scikit-learn 1.9.1,
numpy 2.5.4, pandas 3.0.6, shap 0.54.1 (stored in the artefact; the service warns on a mismatch).

**Data handling.** Large classes capped at 50,000 rows; 601,648 duplicate rows and the 288,602 empty
rows of the Thursday web-attack file dropped; unknown labels rejected, never mapped. Split 60 / 20 /
20 (111,384 train, 37,128 validation, 37,128 test, seed 42). Training took 5 min 07 s.

### 1.1 Held-out test split (same capture, random rows)

Macro-F1 **0.896** (weighted F1 0.993, MCC 0.990, expected calibration error 0.002, 10 ms per 1,000
flows). Per class:

| Class | Precision | Recall | F1 | Support | Note |
|---|---|---|---|---|---|
| Normal | 0.998 | 0.991 | 0.995 | 10,000 | |
| DDoS | 1.000 | 0.999 | 1.000 | 10,000 | |
| DoS Hulk | 0.998 | 0.999 | 0.998 | 10,000 | |
| DoS GoldenEye | 0.996 | 0.998 | 0.997 | 2,057 | |
| DoS Slowloris | 0.994 | 0.998 | 0.996 | 2,123 | |
| FTP-Patator | 0.999 | 0.999 | 0.999 | 1,187 | |
| SSH-Patator | 1.000 | 0.995 | 0.998 | 644 | |
| PortScan | 0.965 | 0.982 | 0.974 | 392 | |
| Botnet | 0.922 | 0.979 | 0.950 | 288 | |
| Web attack (brute force) | 0.781 | 0.619 | 0.691 | 294 | |
| XSS | 0.415 | 0.715 | 0.525 | 130 | the two web classes are confused with each other |
| Infiltration | 0.800 | 0.571 | 0.667 | 7 | unstable (< 30 test rows) |
| SQL injection | 0.750 | 0.750 | 0.750 | 4 | unstable |
| Heartbleed | 1.000 | 1.000 | 1.000 | 2 | unstable |

**How to read it.** Test rows come from the same capture days, hosts and sessions as the training
rows. This measures how well the model separates CICIDS2017's classes, not how it would do on
another network (lesson 10 in `CLAUDE.md`). The volumetric attacks are easy in this dataset; the web
attacks are not, and the three rare classes have too few rows for any estimate.

### 1.2 Unseen source addresses (group-aware holdout)

Rows are grouped by source IP and whole groups are held out (2,922 groups, 7,931 test rows). In
CICIDS2017 the attacks come from a handful of addresses, so this holdout contained **only benign
traffic and 4 Botnet rows**: macro-F1 0.49 over the classes present means nothing for attacks. What
it does show: **2.7 % of benign flows from never-seen sources were flagged as an attack** (benign
recall 0.973). At 100,000 benign flows a day that would be about 2,700 false verdicts, which is why
§2 exists.

Day-wise validation (`split.holdout` in the training config: whole capture days kept out of training)
is implemented and tested, but has **not** been run on the full dataset yet.

## 2. Alert noise on real CICIDS2017 traffic

The 2.83 million flows of all eight days were imported (about 2,100 rows/s) and scored with the model
above (about 300 flows/s with explanations). Re-alerting the 456,833 flows of Thursday afternoon and
Friday from scratch, on an isolated database:

| Settings | Model alerts | Rule alerts | Incidents | Alerts on the real attacker addresses |
|---|---|---|---|---|
| Defaults (minimum confidence 0, empty allowlist) | 1,615 | 8 | 73 | 43 |
| Minimum confidence 90 % + `172.217.0.0/16` allowlisted | 564 | 8 | 27 | 33 |

The threshold removed about two thirds of the alerts **and 10 of the 43 alerts on attacker traffic**:
a trade, not a free win. The largest source of false positives, `205.174.x.x`, is also the attackers'
public address, so allowlisting it would hide the attacks.

**Starter rule R-SLOWHTTP-01.** Replaying all eight days through the rule engine: 161 hits with the
original definition (mostly long benign HTTPS sessions), **15** after restricting it to HTTP ports and
silent servers, with the 8 hits on real slow-HTTP attack flows kept.

## 3. Synthetic DEMO scenario

585 flows written by `npm run demo:data` (office traffic, a port scan, then an SSH brute force from
`10.0.0.66`). The two starter rules catch both phases and correlation groups them into one incident,
**by construction**: the scenario was written to exercise the workflow, so it proves the pipeline
works, not that detection works. The sample model (BENIGN vs DDoS only) scores the SSH flows as
benign, as it should.

## 4. Platform

| What | Measured |
|---|---|
| Dashboard at 3 M synthetic flows | Overview 40.3 s → **2.06 s** p50 with minute rollups (7–23× faster across stats endpoints). **Target p95 < 300 ms not met** ([PERFORMANCE.md](PERFORMANCE.md)). |
| Test suites (2026-10-22, merged `main`) | 105 shared, 197 API (+3 BullMQ tests that need Redis), 94 web, 60 ML, 18 browser journeys with axe accessibility checks: all passing. |
| Production dependency audit | `npm audit --omit=dev`: 0 vulnerabilities (dev-tool advisories listed in [SECURITY_ASVS.md](SECURITY_ASVS.md)). |

## 5. What these numbers do not show

- **Nothing here is measured on a live network.** Live capture is not built; every flow was imported.
- CICIDS2017 has documented label and feature errors (Engelen et al. 2021) and is a 2017 testbed.
  A model trained on it does not transfer to another network; a lab dataset is the planned fix.
- The test split shares hosts and sessions with training, so 0.896 is optimistic even for CICIDS2017.
- Rare classes (Heartbleed, Infiltration, SQL injection) have no usable estimate.
- Accuracy (0.992) is deliberately not the headline: with 10,000 benign test rows it mostly reflects
  the majority classes.
