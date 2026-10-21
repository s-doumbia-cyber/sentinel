"""Model card generation (docs/ML_AND_DETECTION.md §10)."""

from __future__ import annotations


def _fmt(v) -> str:
    return "n/a" if v is None else f"{v:.4f}" if isinstance(v, float) else str(v)


def render_model_card(meta: dict, metrics: dict, cfg: dict) -> str:
    t = metrics["test"]
    on = meta["trainedOn"]
    lines = [
        f"# Model card: {meta['name']}",
        "",
        "## 1. Identity",
        f"- Version: `{meta['version']}`",
        f"- Feature schema: `{meta['schema']}`",
        f"- Kind: **{meta['kind']}**" + (" (benchmark numbers, not production performance)" if meta["kind"] == "benchmark" else ""),
        f"- Algorithm: {meta['algorithm']} (class_weight={meta['classWeight']})",
        f"- Trained at (UTC): {meta['trainedAt']}",
        f"- SHA-256 of model.joblib: `{meta['sha256']}`",
        "- Library versions: " + ", ".join(f"{k} {v}" for k, v in meta["libVersions"].items() if k != "platform"),
        "",
        "## 2. Intended use",
        "Scores network flows that use the same feature schema, to help an analyst triage.",
        "Out of scope: automatic blocking, traffic from networks unlike the training data, any flow of another schema.",
        "",
        "## 3. Training data",
        f"- {cfg.get('description', '').strip() or 'See training_config.yaml.'}",
        f"- Rows used: {on['rows']} (read {on['rows_read']}; duplicates dropped {on['duplicates_dropped']}; "
        f"unknown labels dropped {on['rows_unknown_label']}; missing labels {on['rows_missing_label']}; capped {on['rows_capped']})",
        f"- Non-finite feature values (imputed with the training median): {on['non_finite_values']}",
        "- Files: " + ", ".join(f"{f['name']} ({f['rows']} rows, sha256 {f['sha256'][:12]}...)" for f in on["files"]),
        "- Class counts: " + ", ".join(f"{k}={v}" for k, v in on["classCounts"].items()),
    ]
    if on.get("excludedClasses"):
        lines.append(f"- Excluded (fewer than 5 rows): {', '.join(on['excludedClasses'])}")
    lines += [
        "",
        "## 4. Evaluation (untouched stratified test set)",
        f"- **Macro-F1: {_fmt(t['macroF1'])}** · weighted-F1 {_fmt(t['weightedF1'])} · MCC {_fmt(t['mcc'])} · test rows {t['testRows']}",
        f"- Calibration: expected calibration error {_fmt(t['calibration']['ece'])}",
        f"- Latency: {_fmt(t['latencyMsPer1000'])} ms per 1,000 flows (this machine, no explanations)",
    ]
    if (t["macroF1"] or 0) >= 0.99:
        lines.append(
            "- **Warning:** near-perfect scores on a random split usually mean an easy or leaky benchmark,"
            " not a strong detector. Read the group-aware result below before trusting these numbers."
        )
    lines += [
        "",
        "| Class | Precision | Recall | F1 | PR-AUC | Support | Note |",
        "|---|---|---|---|---|---|---|",
    ]
    for c in t["perClass"]:
        note = "unstable estimate (< 30 test rows)" if c["unstable"] else ""
        lines.append(f"| {c['label']} | {_fmt(c['precision'])} | {_fmt(c['recall'])} | {_fmt(c['f1'])} | {_fmt(c['prAuc'])} | {c['support']} | {note} |")
    cm = t["confusionMatrix"]
    lines += ["", "Confusion matrix (rows = truth, columns = prediction):", "", "| | " + " | ".join(cm["labels"]) + " |", "|---" * (len(cm["labels"]) + 1) + "|"]
    for label, row in zip(cm["labels"], cm["matrix"]):
        lines.append(f"| **{label}** | " + " | ".join(str(v) for v in row) + " |")
    sel = metrics["selection"]
    lines += ["", "### Model selection (validation set)", "", "| Algorithm | class_weight | Val macro-F1 | Min critical recall | ms / 1k |", "|---|---|---|---|---|"]
    for c in sel["candidates"]:
        lines.append(f"| {c['algorithm']} | {c['classWeight']} | {_fmt(c['valMacroF1'])} | {_fmt(c['valMinCriticalRecall'])} | {_fmt(c['latencyMsPer1000'])} |")
    if sel.get("warning"):
        lines.append(f"\n**Selection warning:** {sel['warning']}")
    g = metrics["groupAware"]
    lines += ["", "### Group-aware holdout (by source IP)"]
    if g["status"] == "ok":
        lines.append(f"- Macro-F1 {_fmt(g['macroF1'])} on {g['testRows']} rows from unseen source IPs ({g['groups']} groups).")
        for c in g.get("perClass", []):
            lines.append(
                f"  - {c['label']}: precision {_fmt(c['precision'])}, recall {_fmt(c['recall'])}, support {c['support']}"
            )
        if g["classesMissingFromTest"]:
            lines.append(f"- Classes absent from the group test side: {', '.join(g['classesMissingFromTest'])} (no estimate possible).")
        if g["classesMissingFromTrain"]:
            lines.append(f"- Classes absent from the group training side: {', '.join(g['classesMissingFromTrain'])}.")
    else:
        lines.append(f"- Not possible: {g['reason']}.")
    h = metrics.get("heldOut", {"status": "not_configured"})
    lines += ["", f"### Held-out {h.get('by', 'groups')} (whole groups kept out of training)"]
    if h["status"] == "not_configured":
        lines.append("- Not configured (`split.holdout`): every capture day contributed to training, so no day-wise estimate exists.")
    elif h["status"] == "ok":
        lines.append(
            f"- The shipped model was trained without: {', '.join(h['groups'])}. "
            f"Macro-F1 **{_fmt(h['macroF1'])}** on {h['testRows']} held-out rows (training rows: {h['trainRows']})."
        )
        lines += ["", "| Class | Precision | Recall | F1 | Support | Note |", "|---|---|---|---|---|---|"]
        for c in h["perClass"]:
            note = "unstable estimate (< 30 held-out rows)" if c["unstable"] else ""
            lines.append(f"| {c['label']} | {_fmt(c['precision'])} | {_fmt(c['recall'])} | {_fmt(c['f1'])} | {c['support']} | {note} |")
        if h.get("perGroup"):
            lines += ["", "| Group | Rows | Macro-F1 (classes present in that group) |", "|---|---|---|"]
            for pg in h["perGroup"]:
                lines.append(f"| {pg['group']} | {pg['rows']} | {_fmt(pg['macroF1'])} |")
    else:
        lines.append(f"- Not possible: {h.get('reason')}.")
    for w in h.get("warnings", []):
        lines.append(f"- **Warning:** {w}")
    nv = metrics.get("novelty", {"status": "not_configured"})
    lines += ["", "### Novelty detector (unusual behaviour)"]
    if nv["status"] == "ok":
        lines += [
            f"- IsolationForest fitted on {nv['trainedOnRows']} benign training rows; a flow scoring at or above {_fmt(nv['threshold'])}"
            f" (the {nv['quantile']:.0%} quantile of benign training scores) is statistically unusual compared with that traffic.",
            f"- Measured on the held-out test split: {_fmt(nv['benignFalsePositiveRate'])} of {nv['benignRows']} benign rows were above the threshold.",
            "- It is not a diagnosis and is never mapped to an attack class. Known attacks are also unusual compared with benign traffic,"
            " so Sentinel reports \"unusual behaviour\" only when a flow is above the threshold and the classifier did not recognise it with confidence.",
        ]
        if nv["perClass"]:
            lines += ["", "| Class | Test rows | Share above the novelty threshold |", "|---|---|---|"]
            lines += [f"| {c['label']} | {c['support']} | {_fmt(c['flaggedShare'])} |" for c in nv["perClass"]]
    elif nv["status"] == "not_possible":
        lines.append(f"- Not trained: {nv.get('reason')}.")
    else:
        lines.append("- Not configured (`novelty.enabled` in the training config).")
    ref = meta.get("reference")
    if ref:
        lines += [
            "",
            "### Drift reference",
            f"- `reference.json` stores a {ref['bins']}-bin histogram per feature from the {ref['rows']} rows the model was fitted on."
            " The Models page compares recent scored flows with it (population stability index); it measures change, not accuracy.",
        ]
    lines += [
        "",
        "## 5. Cross-dataset results",
        "Not measured yet. A CICIDS2017 model is expected to transfer poorly to other networks;",
        "the lab dataset and the `sentinel-native-v1` schema (roadmap Phase 2) exist to measure this honestly.",
        "",
        "## 6. Known limitations",
        "- CICIDS2017 has documented label and feature errors (Engelen et al. 2021; Liu et al. 2022).",
        "- A 2017 testbed does not represent your network; scores are not production performance.",
        "- Classes with small support give unstable estimates; random splits of flow data can leak (see group-aware result).",
        "- Destination port is excluded from the features to limit shortcut learning on fixed testbed ports.",
        "",
        "## 7. Ethical and operational notes",
        "Human in the loop: verdicts below the org confidence threshold are marked needs-review. No automatic blocking.",
        "Explanations (SHAP / coefficients) describe the model's behaviour, not the causes of an attack.",
        "",
    ]
    return "\n".join(lines)
