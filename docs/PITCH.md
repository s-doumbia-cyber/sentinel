# Sentinel — One-page pitch

**Explainable network threat detection and triage for small security teams.**

## The problem

Small security teams (SMBs, universities, small MSSPs) cannot afford Splunk, Microsoft Sentinel or
QRadar, and the open-source alternatives hand them raw alerts with no reasons. Machine-learning
"detectors" in student and vendor demos often report 99 % accuracy on the data they were trained on,
then drown a real team in false positives. Analysts end up distrusting the tool.

## What Sentinel does

1. **Detects** suspicious network flows with a served ML model and a rules engine you can read.
2. **Explains** every alert: what was observed (the flows, the file, its hash), what was inferred (the
   model's top reasons, the rule threshold, a MITRE technique marked *suggested*) and what is unknown.
3. **Groups** related alerts into incidents, labelled hypotheses, with an attack timeline and a graph
   of who talked to whom.
4. **Guides** the response (checks, containment ideas, blocklist simulations) and writes the report,
   including an executive PDF with time to triage and the limits of the data.

## Why it is different

| Most tools | Sentinel |
|---|---|
| "99 % accuracy" | Macro-F1 and per-class support, shown in the app; weak classes (XSS 0.53) are visible |
| A label from the dataset passes as a detection | Verdicts come only from a model or a rule; dataset labels are used for evaluation only |
| Data of unknown origin | Every record tagged LIVE / REPLAY / IMPORTED / DEMO |
| Alert floods | Minimum confidence and an allowlist, with the trade-off measured (fewer alerts, some misses) |
| "Blocked!" | Recommends and simulates; never claims an action it did not take |

## Proof

- 2.83 million real CICIDS2017 flows imported and scored; macro-F1 0.896 on the held-out split, and
  2.7 % of benign flows flagged on never-seen sources, reported as such ([EVALUATION.md](EVALUATION.md)).
- Noise controls measured on the same data: 1,615 → 564 model alerts, at the cost of 10 of 43 alerts
  on real attacker traffic.
- About 470 automated tests: unit, API integration on a real MongoDB, ML, and 18 browser journeys with
  accessibility checks.

## Under the hood

React + TypeScript web app, Express API (TypeScript, zod), FastAPI ML service (scikit-learn, SHAP),
MongoDB, Redis job queue (BullMQ), Docker Compose, GitHub Actions. Multi-tenant with server-side
roles, argon2id, rotating refresh cookies, optional TOTP, audit log, OWASP ASVS L1 checklist, French
and English interface (partial).

## Honest limits

Live capture, outbound integrations (webhooks, Slack) and automatic enforcement are not built. A
model trained on CICIDS2017 does not transfer to another network. The dashboard misses its 300 ms
target at 3 million flows (2 s today).

## Next

A flow collector for live and lab traffic, a lab-built dataset to retrain on, outbound alerting, and a
dashboard cache to meet the latency target.

*Built by Souleymane Doumbia (BCA, cybersecurity).*
