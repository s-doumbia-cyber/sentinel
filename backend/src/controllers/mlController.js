import fs from "fs";
import path from "path";

const METRICS_PATH = path.resolve(process.cwd(), "data", "model-metrics.json");

export function getModelMetrics(req, res) {
  if (!fs.existsSync(METRICS_PATH)) {
    return res.status(404).json({
      message:
        "No trained model yet. Run 'python ml/train_model.py' from the backend/ folder (see docs/03-api-and-schema.md).",
    });
  }
  const metrics = JSON.parse(fs.readFileSync(METRICS_PATH, "utf-8"));
  res.json(metrics);
}
