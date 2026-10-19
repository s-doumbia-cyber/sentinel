import "dotenv/config";
import { connectDB } from "../config/db.js";
import { NetworkFlow, ATTACK_TYPES } from "../models/NetworkFlow.js";
import { User } from "../models/User.js";
import mongoose from "mongoose";

// Run with: node src/scripts/seed.js
// Populates a demo analyst account and a batch of realistic-looking flows so
// the dashboard has data to render immediately after backend setup.

function randomIp() {
  return `${rand(1, 223)}.${rand(0, 255)}.${rand(0, 255)}.${rand(1, 254)}`;
}
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const SEVERITY_BY_LABEL = {
  DDoS: "critical",
  Botnet: "critical",
  Heartbleed: "critical",
  SQLInjection: "high",
  Infiltration: "high",
  DoSHulk: "high",
  WebAttack: "high",
  XSS: "high",
  SSHPatator: "medium",
  FTPPatator: "medium",
  BruteForce: "medium",
  DoSSlowloris: "medium",
  PortScan: "low",
  Normal: "safe",
};

const COUNTRIES = ["United States", "China", "Russia", "Brazil", "India", "Germany", "Iran", "Vietnam", "Netherlands", "Ukraine"];

async function seed() {
  await connectDB();

  const email = "analyst@sentinel.io";
  const existing = await User.findOne({ email });
  if (!existing) {
    await User.create({
      name: "Demo Analyst",
      email,
      passwordHash: await User.hashPassword("ChangeMe123!"),
      role: "Admin",
    });
    console.log(`[seed] Created demo user: ${email} / ChangeMe123!`);
  }

  await NetworkFlow.deleteMany({});
  const batch = [];
  for (let i = 0; i < 2000; i++) {
    const isAttack = Math.random() > 0.6;
    const label = isAttack ? pick(ATTACK_TYPES.filter((t) => t !== "Normal")) : "Normal";
    batch.push({
      timestamp: new Date(Date.now() - rand(0, 1000 * 60 * 60 * 24 * 30)),
      sourceIp: randomIp(),
      destinationIp: randomIp(),
      sourcePort: rand(1, 65535),
      destinationPort: pick([80, 443, 22, 21, 3389, 8080, 53, 3306]),
      protocol: pick(["TCP", "UDP", "ICMP"]),
      flowDurationMs: rand(1, 12000),
      packetLength: rand(40, 1500),
      label,
      prediction: Math.random() > 0.08 ? label : pick(ATTACK_TYPES),
      severity: SEVERITY_BY_LABEL[label],
      country: pick(COUNTRIES),
      isAttack,
    });
  }
  await NetworkFlow.insertMany(batch);
  console.log(`[seed] Inserted ${batch.length} network flows`);

  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
