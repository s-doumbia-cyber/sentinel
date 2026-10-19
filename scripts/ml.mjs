#!/usr/bin/env node
/* eslint-disable no-console -- CLI output is the point of this script. */
// Cross-platform helper for services/ml (Windows PowerShell and Linux/macOS).
//
//   node scripts/ml.mjs install        create services/ml/.venv and install the package (+dev)
//   node scripts/ml.mjs train-sample   train the benchmark model on data/samples
//   node scripts/ml.mjs serve          run the inference API on 127.0.0.1:8000
//   node scripts/ml.mjs test           run pytest
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mlDir = path.join(root, "services", "ml");
const isWin = process.platform === "win32";
const venvPython = path.join(mlDir, ".venv", isWin ? "Scripts" : "bin", isWin ? "python.exe" : "python");

function run(cmd, args, cwd = mlDir) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: false });
  if (r.error) {
    console.error(`Could not run ${cmd}: ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function systemPython() {
  for (const candidate of isWin ? ["py", "python"] : ["python3", "python"]) {
    const r = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (r.status === 0) return candidate;
  }
  console.error("Python 3.11+ was not found on PATH.");
  process.exit(1);
}

function requireVenv() {
  if (!existsSync(venvPython)) {
    console.error("services/ml/.venv is missing. Run: npm run ml:install");
    process.exit(1);
  }
}

const command = process.argv[2];
switch (command) {
  case "install": {
    if (!existsSync(venvPython)) run(systemPython(), ["-m", "venv", ".venv"]);
    run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
    run(venvPython, ["-m", "pip", "install", "-e", ".[dev]"]);
    break;
  }
  case "train-sample":
    requireVenv();
    run(venvPython, ["-m", "sentinel_ml.train", "--config", "configs/cicids-sample.yaml"]);
    break;
  case "serve":
    requireVenv();
    run(venvPython, ["-m", "sentinel_ml.serve", ...process.argv.slice(3)]);
    break;
  case "test":
    requireVenv();
    run(venvPython, ["-m", "pytest"]);
    break;
  default:
    console.error("Usage: node scripts/ml.mjs <install|train-sample|serve|test>");
    process.exit(1);
}
