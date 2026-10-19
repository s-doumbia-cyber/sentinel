# 05 — Guidance for the Written Report / Viva

This file is notes for *you*, not generated documentation about the app — specific language and framing to reuse when writing the project report or presenting to a jury. Each point below turns a technical limitation into evidence of understanding, which is what a cybersecurity jury is actually evaluating.

## On the Real-Time Monitor

Be explicit and upfront about what it is, rather than letting it be mistaken for live packet capture:

> "The Real-Time Monitor replays real, previously-captured flows from the imported dataset on a fixed timer. A browser-based web application cannot sniff live network traffic directly — that requires an OS-level agent with raw socket access (e.g. a packet capture library or a network tap). A production implementation would stream events from a network probe (e.g. Zeek or Suricata) over a message queue or WebSocket into the same MongoDB collection this dashboard already reads from — the API and UI layers would not need to change, only the ingestion source."

This framing shows you understand the actual constraint (browser sandboxing) and the real production architecture, rather than just having built a workaround.

## On the Machine Learning comparison

Lead with the comparison table, not a single model's numbers. Something like:

| Model | Accuracy | Precision | Recall | F1 |
|---|---|---|---|---|
| Random Forest | ... | ... | ... | ... |
| Gradient Boosting | ... | ... | ... | ... |
| Logistic Regression (baseline) | ... | ... | ... | ... |

Pull the actual numbers from `backend/data/model-metrics.json` after running `python ml/train_model.py`. Explain *why* three models: Logistic Regression as a simple linear baseline, Random Forest and Gradient Boosting as two different ensemble strategies (bagging vs. boosting) — and that the app automatically picks whichever scored highest on F1 (a jury will ask why F1 rather than accuracy alone: because the classes are imbalanced — Normal traffic vastly outnumbers rarer attack types like Heartbleed, so accuracy alone can be misleading).

## On feature selection

Document which CICIDS2017 features you actually used and why, not just the final result:

- **Flow Duration, Total Fwd/Backward Packets, Total Length of Fwd/Bwd Packets** — basic volume/timing signals that already separate short bursty scans from long sustained connections.
- **Flow Bytes/s, Flow Packets/s** — rate-based features; DDoS and DoS attacks characteristically spike these relative to baseline traffic.
- **Flow IAT Mean/Std, Fwd/Bwd IAT Mean** — inter-arrival time statistics; automated attack tools tend to have far more regular (low-variance) timing than human-driven traffic.
- **SYN/ACK/RST/PSH Flag Counts** — TCP flag distributions are classically diagnostic for scan types (e.g. SYN floods, PortScan) and are exactly the kind of feature a real IDS (e.g. Zeek, Suricata) surfaces.
- **Average/Min/Max Packet Length** — payload-size signatures differ meaningfully between exploit traffic and normal application traffic.

These come straight from the dataset's own `raw` CSV columns, preserved on every `NetworkFlow` document precisely so features beyond the normalized schema stay available for analysis like this — mention that design decision explicitly, it shows forward planning rather than an afterthought.

## On the CICIDS2017 label taxonomy

Be upfront that `normalizeLabel()` in `csvImporter.js` **skips** (rather than guesses at) any raw CSV label it doesn't recognize, logging the exact unrecognized string. This is a deliberate data-quality choice: silently bucketing unknown labels into a catch-all category would quietly corrupt the dataset's statistics. Mention the console warning format (`[import] Unrecognized label skipped: "..."`) as your project's audit trail for data-cleaning decisions.

## On the "Most Active Attacking Hosts" / subnet panels replacing geo-attribution

Explain the reasoning, not just the result: CICIDS2017 was captured on an isolated private-IP testbed (RFC 1918 address ranges), so there is no genuine public geolocation to derive — any "Most Dangerous Countries" panel built on this dataset would have to fabricate data. Host- and subnet-level attribution (`getTopAttackers`, `getTopSubnets`) is the honest substitute that the dataset actually supports, and is arguably more operationally useful for a SOC analyst working an internal network anyway.

## Suggested report structure

1. Problem statement & dataset (CICIDS2017: what it captures, why it's a standard benchmark)
2. System architecture (React/Express/MongoDB — point to `docs/01-architecture.md`)
3. Data pipeline (CSV → MongoDB import, schema design, label normalization and data-quality handling)
4. Dashboard & analytics features (what each page answers)
5. Machine learning: feature selection, three-model comparison table, confusion matrix discussion, what the model gets wrong and why (look at the off-diagonal cells of the confusion matrix — which attack types get confused with which, and why that makes sense given their traffic patterns)
6. Known limitations, stated as design decisions: Real-Time Monitor replay, no live packet capture, no geo-attribution, Settings language selector not yet wired to real UI translation
7. Future work: WebSocket-based live ingestion from a real probe, additional models (e.g. XGBoost, a simple neural net), role-based access control (the `requireRole` middleware already exists but isn't yet enforced on any route)
