import { Incident } from "../models/Incident.js";
import { NetworkFlow } from "../models/NetworkFlow.js";

const ANALYSTS = ["A. Kade", "M. Reyes", "S. Okafor", "J. Tran", "L. Novak", "Unassigned"];
const STATUSES = ["Open", "Investigating", "Resolved", "Closed"];
const PRIORITY_BY_SEVERITY = { critical: "P1", high: "P2" };

// Turns the most frequent high/critical-severity source IPs in the real,
// imported flow data into incident records. Only runs once (when the
// incidents collection is empty) so re-visiting the page doesn't keep
// regenerating a different random assignment on every request.
async function generateIncidentsFromFlows() {
  const grouped = await NetworkFlow.aggregate([
    { $match: { isAttack: true, severity: { $in: ["critical", "high"] } } },
    {
      $group: {
        _id: { sourceIp: "$sourceIp", label: "$label", severity: "$severity" },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 30 },
  ]);

  if (grouped.length === 0) return;

  const docs = grouped.map((g, i) => ({
    title: `${g._id.label} activity detected from ${g._id.sourceIp} (${g.count} flows)`,
    attackType: g._id.label,
    status: STATUSES[i % STATUSES.length],
    priority: PRIORITY_BY_SEVERITY[g._id.severity] || "P3",
    severity: g._id.severity,
    assignee: ANALYSTS[i % ANALYSTS.length],
    sourceIp: g._id.sourceIp,
  }));

  await Incident.insertMany(docs);
}

export async function listIncidents(req, res, next) {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;

    const existingCount = await Incident.countDocuments();
    if (existingCount === 0) {
      await generateIncidentsFromFlows();
    }

    const incidents = await Incident.find(filter).sort({ createdAt: -1 }).lean();
    res.json(incidents);
  } catch (err) {
    next(err);
  }
}

export async function createIncident(req, res, next) {
  try {
    const incident = await Incident.create(req.body);
    res.status(201).json(incident);
  } catch (err) {
    next(err);
  }
}

export async function updateIncident(req, res, next) {
  try {
    const incident = await Incident.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!incident) return res.status(404).json({ message: "Incident not found" });
    res.json(incident);
  } catch (err) {
    next(err);
  }
}

export async function deleteIncident(req, res, next) {
  try {
    const incident = await Incident.findByIdAndDelete(req.params.id);
    if (!incident) return res.status(404).json({ message: "Incident not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
