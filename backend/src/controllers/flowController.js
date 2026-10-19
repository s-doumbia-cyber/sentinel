import { NetworkFlow } from "../models/NetworkFlow.js";

// Builds a Mongo filter object from supported query params. Centralized here so
// every endpoint (list, kpis, aggregations) applies filters identically.
function buildFilter(query) {
  const filter = {};
  if (query.attackType) filter.label = query.attackType;
  if (query.onlyAttacks === "true") filter.isAttack = true;
  if (query.protocol) filter.protocol = query.protocol;
  if (query.severity) filter.severity = query.severity;
  if (query.sourceIp) filter.sourceIp = query.sourceIp;
  if (query.destinationIp) filter.destinationIp = query.destinationIp;
  if (query.port) filter.destinationPort = Number(query.port);
  if (query.country) filter.country = query.country;
  if (query.from || query.to) {
    filter.timestamp = {};
    if (query.from) filter.timestamp.$gte = new Date(query.from);
    if (query.to) filter.timestamp.$lte = new Date(query.to);
  }
  return filter;
}

export async function listFlows(req, res, next) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Number(req.query.limit) || 25);
    const filter = buildFilter(req.query);
    const sortField = req.query.sortBy || "timestamp";
    const sortDir = req.query.sortDir === "asc" ? 1 : -1;

    const [rows, total] = await Promise.all([
      NetworkFlow.find(filter)
        .sort({ [sortField]: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      NetworkFlow.countDocuments(filter),
    ]);

    res.json({ rows, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
}

export async function getKpis(req, res, next) {
  try {
    const filter = buildFilter(req.query);
    const hasFilter = Object.keys(filter).length > 0;

    // countDocuments() with an empty filter still does real work in MongoDB;
    // estimatedDocumentCount() reads collection metadata instead and is
    // effectively instant, which matters a lot once the collection holds
    // millions of rows (the common case here once a few CICIDS2017 days are
    // imported). Only fall back to the accurate-but-slower count when a
    // filter is actually applied.
    const [total, attacks, uniqueSrc, uniqueDst, avg] = await Promise.all([
      hasFilter ? NetworkFlow.countDocuments(filter) : NetworkFlow.estimatedDocumentCount(),
      NetworkFlow.countDocuments({ ...filter, isAttack: true }),
      NetworkFlow.distinct("sourceIp", filter),
      NetworkFlow.distinct("destinationIp", filter),
      NetworkFlow.aggregate([
        { $match: filter },
        { $sample: { size: 200000 } }, // cap the scan for huge collections; still representative
        { $group: { _id: null, avgPacket: { $avg: "$packetLength" }, avgDuration: { $avg: "$flowDurationMs" } } },
      ]).allowDiskUse(true),
    ]);

    res.json({
      totalFlows: total,
      totalAttacks: attacks,
      normalTraffic: total - attacks,
      attackPercentage: total ? Number(((attacks / total) * 100).toFixed(2)) : 0,
      uniqueSourceIps: uniqueSrc.length,
      uniqueDestinationIps: uniqueDst.length,
      avgPacketSize: Math.round(avg[0]?.avgPacket ?? 0),
      avgFlowDuration: Math.round(avg[0]?.avgDuration ?? 0),
    });
  } catch (err) {
    next(err);
  }
}

export async function getAttackBreakdown(req, res, next) {
  try {
    const filter = { ...buildFilter(req.query), isAttack: true };
    const data = await NetworkFlow.aggregate([
      { $match: filter },
      { $group: { _id: "$label", value: { $sum: 1 } } },
      { $project: { _id: 0, name: "$_id", value: 1 } },
      { $sort: { value: -1 } },
    ]).allowDiskUse(true);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getTimeline(req, res, next) {
  try {
    const filter = buildFilter(req.query);
    const data = await NetworkFlow.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, isAttack: "$isAttack" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]).allowDiskUse(true);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getTopPorts(req, res, next) {
  try {
    const filter = { ...buildFilter(req.query), isAttack: true };
    const data = await NetworkFlow.aggregate([
      { $match: filter },
      { $group: { _id: "$destinationPort", value: { $sum: 1 } } },
      { $project: { _id: 0, port: "$_id", value: 1 } },
      { $sort: { value: -1 } },
      { $limit: 10 },
    ]).allowDiskUse(true);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getSeverityBreakdown(req, res, next) {
  try {
    const filter = { ...buildFilter(req.query), isAttack: true };
    const data = await NetworkFlow.aggregate([
      { $match: filter },
      { $group: { _id: "$severity", value: { $sum: 1 } } },
      { $project: { _id: 0, name: "$_id", value: 1 } },
      { $sort: { value: -1 } },
    ]).allowDiskUse(true);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

// Real, meaningful replacement for geo-attribution on datasets like CICIDS2017
// where source IPs are internal/private and carry no genuine location data:
// which specific hosts on the network launched the most attack traffic.
export async function getTopAttackers(req, res, next) {
  try {
    const filter = { ...buildFilter(req.query), isAttack: true };
    const data = await NetworkFlow.aggregate([
      { $match: filter },
      { $group: { _id: "$sourceIp", attacks: { $sum: 1 }, types: { $addToSet: "$label" } } },
      { $project: { _id: 0, sourceIp: "$_id", attacks: 1, types: 1 } },
      { $sort: { attacks: -1 } },
      { $limit: 10 },
    ]).allowDiskUse(true);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

// Complements getTopAttackers with a coarser view: grouping by the first
// octet of the source IP surfaces a whole misbehaving subnet/segment even
// when individual hosts within it each generate a modest flow count.
export async function getTopSubnets(req, res, next) {
  try {
    const filter = { ...buildFilter(req.query), isAttack: true };
    const data = await NetworkFlow.aggregate([
      { $match: filter },
      { $addFields: { subnet: { $arrayElemAt: [{ $split: ["$sourceIp", "."] }, 0] } } },
      { $group: { _id: "$subnet", attacks: { $sum: 1 } } },
      { $project: { _id: 0, subnet: "$_id", attacks: 1 } },
      { $sort: { attacks: -1 } },
      { $limit: 15 },
    ]).allowDiskUse(true);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
