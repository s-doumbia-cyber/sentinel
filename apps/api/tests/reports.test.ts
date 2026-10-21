import request from "supertest";
import { describe, expect, it } from "vitest";
import { AuditLog, IncidentEvent } from "../src/models/tenant.js";
import { executiveDocument, periodLabel } from "../src/modules/reports/blocks.js";
import { buildExecutiveReport } from "../src/modules/reports/executive.service.js";
import { pdfSafe, renderPdf, type PdfBlock } from "../src/modules/reports/pdf.js";
import { API, FakeMl, addMember, buildApp, oid, registerUser, writeCsv, type CsvRow } from "./helpers.js";
import { pdfPageCount, pdfText } from "./pdfText.js";

const sa = buildApp({ ml: new FakeMl() });

const scan = (src: string, at: string): CsvRow[] =>
  Array.from({ length: 120 }, (_, i) => ({
    srcIp: src,
    dstIp: "192.168.10.50",
    timestamp: at,
    label: "PortScan",
    raw: { "Destination Port": String(1000 + i), "Total Fwd Packets": "1", "Total Backward Packets": "1" },
  }));
const sshBurst = (src: string, at: string): CsvRow[] =>
  Array.from({ length: 40 }, () => ({ srcIp: src, dstIp: "192.168.10.50", timestamp: at, label: "SSH-Patator", raw: { "Destination Port": "22", "Flow Duration": "500000" } }));
const ddos = (src: string, at: string): CsvRow[] => Array.from({ length: 30 }, () => ({ srcIp: src, dstIp: "192.168.10.60", timestamp: at, label: "DDoS", features: { "Flow Packets/s": "5000" } }));
const benign = (at: string): CsvRow[] => Array.from({ length: 20 }, () => ({ srcIp: "10.1.1.1", dstIp: "192.168.10.70", timestamp: at, label: "BENIGN" }));

async function seed() {
  const u = await registerUser(sa);
  const auth = { Authorization: `Bearer ${u.token}` };
  await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
  const res = await request(sa.app)
    .post(`${API}/imports/csv`)
    .set(auth)
    .attach("file", writeCsv([...scan("10.9.9.9", "7/7/2017 3:40"), ...sshBurst("10.9.9.9", "7/7/2017 3:45"), ...ddos("10.7.7.7", "7/7/2017 4:10"), ...benign("7/7/2017 4:20")]));
  expect(res.status).toBe(202);
  await sa.jobs.idle();
  const alerts = (await request(sa.app).get(`${API}/alerts`).set(auth)).body.items as { id: string; type: string }[];
  // One analyst touch, so there is a time to triage.
  await request(sa.app).patch(`${API}/alerts/${alerts[0]?.id}`).set(auth).send({ status: "acknowledged" }).expect(200);
  const incident = (await request(sa.app).get(`${API}/incidents`).set(auth)).body.items[0] as { id: string; title: string };
  return { u, auth, alerts, incident, datasetId: res.body.id as string };
}

const RANGE = { from: "2017-07-07T03:00:00.000Z", to: "2017-07-07T05:00:00.000Z" };

describe("executive report: same numbers as the dashboard", () => {
  it("matches the overview, verdict mix, top sources, top ports and alert summary for the same range", async () => {
    const { auth } = await seed();
    const get = (path: string, query: Record<string, string | number> = {}) => request(sa.app).get(`${API}${path}`).query(query).set(auth).expect(200);
    for (const range of [RANGE, { from: "2017-07-07T03:44:00.000Z", to: "2017-07-07T04:15:00.000Z" }, { from: "2018-01-01T00:00:00.000Z", to: "2018-02-01T00:00:00.000Z" }, {}]) {
      const [report, overview, verdicts, attackers, ports, summary] = await Promise.all([
        get("/reports/executive", range),
        get("/stats/overview", range),
        get("/stats/breakdown", { ...range, by: "verdict" }),
        get("/stats/top", { ...range, kind: "attackers", limit: 10 }),
        get("/stats/top", { ...range, kind: "ports", limit: 10 }),
        get("/alerts/summary", range),
      ]);
      const label = JSON.stringify(range);
      expect(report.body.flows, label).toEqual(overview.body);
      expect(report.body.verdicts, label).toEqual(verdicts.body.items);
      expect(report.body.topSources, label).toEqual(attackers.body.items);
      expect(report.body.topPorts, label).toEqual(ports.body.items);
      expect(report.body.alerts, label).toEqual(summary.body);
    }
  });

  it("is not trivially empty on the seeded range, and says nothing happened outside it", async () => {
    const { auth } = await seed();
    const inside = (await request(sa.app).get(`${API}/reports/executive`).query(RANGE).set(auth)).body;
    expect(inside.flows.totalFlows).toBe(210);
    expect(inside.flows.maliciousFlows).toBeGreaterThan(0);
    expect(inside.alerts.total).toBeGreaterThanOrEqual(3);
    expect(inside.alerts.byType.PortScan).toBeGreaterThanOrEqual(1);
    expect(inside.incidents.total).toBeGreaterThanOrEqual(1);
    const outside = (await request(sa.app).get(`${API}/reports/executive`).query({ from: "2018-01-01T00:00:00.000Z", to: "2018-02-01T00:00:00.000Z" }).set(auth)).body;
    expect(outside.flows.totalFlows).toBe(0);
    expect(outside.alerts.total).toBe(0);
    expect(outside.incidents.total).toBe(0);
    expect(outside.evaluation).toBeNull();
    expect(outside.headline.join(" ")).toMatch(/No alert overlapped the period/);
  });

  it("reports triage time only for alerts an analyst touched, and never counts the rest as zero", async () => {
    const { auth } = await seed();
    const { triage } = (await request(sa.app).get(`${API}/reports/executive`).query(RANGE).set(auth)).body;
    expect(triage.triaged).toBe(1);
    expect(triage.alertsConsidered).toBeGreaterThan(1);
    expect(triage.untriaged).toBe(triage.alertsConsidered - 1);
    expect(triage.meanMinutes).toBeGreaterThanOrEqual(0);
    expect(triage.medianMinutes).toBe(triage.meanMinutes);
    expect(triage.basis).toMatch(/not .* zero/);
    const fresh = await registerUser(sa);
    const empty = (await request(sa.app).get(`${API}/reports/executive`).set("Authorization", `Bearer ${fresh.token}`)).body;
    expect(empty.triage).toMatchObject({ alertsConsidered: 0, triaged: 0, meanMinutes: null, medianMinutes: null });
  });

  it("carries provenance, honest detection quality on labelled data and the limitations", async () => {
    const { auth } = await seed();
    const r = (await request(sa.app).get(`${API}/reports/executive`).query(RANGE).set(auth)).body;
    expect(r.provenance.datasets).toHaveLength(1);
    expect(r.provenance.datasets[0]).toMatchObject({ sourceKind: "IMPORTED", flows: 210 });
    expect(r.provenance.datasets[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(r.provenance.models).toContain("bench-a");
    expect(r.provenance.rules.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining(["R-PORTSCAN-01", "R-BRUTEFORCE-SSH-01"]));
    expect(r.evaluation.evaluatedFlows).toBeGreaterThan(0);
    expect(r.evaluation.perClass.length).toBeGreaterThan(0);
    expect(r.evaluation.perClass[0]).toEqual(expect.objectContaining({ support: expect.any(Number), unstable: expect.any(Boolean) }));
    expect(r.limitations.join(" ")).toMatch(/never a dataset label/);
    expect(r.limitations.join(" ")).toMatch(/does not block, isolate or change/);
    expect(r.meta).toMatchObject({ reportVersion: 1, timezone: "UTC", range: RANGE });
  });

  it("validates the range, stays inside the organisation, and is readable by every role", async () => {
    const { u, auth } = await seed();
    const get = (query: Record<string, string>, headers = auth) => request(sa.app).get(`${API}/reports/executive`).query(query).set(headers);
    expect((await get({ from: "yesterday" })).status).toBe(400);
    expect((await get({ from: RANGE.to, to: RANGE.from })).status).toBe(400);
    const other = await registerUser(sa);
    const theirs = await get(RANGE, { Authorization: `Bearer ${other.token}` });
    expect(theirs.body.flows.totalFlows).toBe(0);
    expect(theirs.body.alerts.total).toBe(0);
    const viewer = await addMember(u.orgId, "Viewer");
    expect((await get(RANGE, { Authorization: `Bearer ${viewer.token}` })).status).toBe(200);
    expect((await request(sa.app).get(`${API}/reports/executive`)).status).toBe(401);
  });
});

describe("executive report PDF", () => {
  it("is a real PDF whose text carries the same numbers, generated by an audited POST", async () => {
    const { u, auth } = await seed();
    const json = (await request(sa.app).get(`${API}/reports/executive`).query(RANGE).set(auth)).body;
    const res = await request(sa.app).post(`${API}/reports/executive/pdf`).query(RANGE).set(auth).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="sentinel-executive-report-2017-07-07_2017-07-07.pdf"');
    expect(res.headers["cache-control"]).toBe("no-store");
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.subarray(-8).toString()).toContain("%%EOF");
    expect(pdfPageCount(pdf)).toBeGreaterThanOrEqual(1);
    const text = pdfText(pdf);
    expect(text).toContain("Executive report");
    expect(text).toContain(String(json.flows.totalFlows));
    expect(text).toContain("Limitations");
    expect(text).toContain("Time to triage");
    expect(text).toMatch(/page 1 of \d+/);
    expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action: "report.executive_pdf" })).toBe(1);
    const entry = await AuditLog.findOne({ orgId: oid(u.orgId), action: "report.executive_pdf" }).lean();
    expect(entry?.meta).toMatchObject({ from: RANGE.from, to: RANGE.to });
    // Viewers may read reports (stats:read) but the PDF still goes through the same checks.
    const viewer = await addMember(u.orgId, "Viewer");
    expect((await request(sa.app).post(`${API}/reports/executive/pdf`).set("Authorization", `Bearer ${viewer.token}`)).status).toBe(200);
    expect((await request(sa.app).post(`${API}/reports/executive/pdf`).query({ from: "nope" }).set(auth)).status).toBe(400);
  });
});

describe("incident report PDF", () => {
  it("renders the incident report, records the event with its format, and stays in the organisation", async () => {
    const { u, auth, incident } = await seed();
    const res = await request(sa.app).post(`${API}/incidents/${incident.id}/report/pdf`).set(auth).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="sentinel-incident-discovery-credential-access-from-10-9-9-9-[0-9a-f]{6}\.pdf"$/);
    const text = pdfText(res.body as Buffer);
    // The arrow is not in the built-in fonts, so it is written as "->" rather than lost.
    expect(text).toContain("Discovery -> Credential access from 10.9.9.9");
    expect(text).toContain("Observed activity (event time, UTC)");
    expect(text).toContain("Chain of custody");
    expect(text).toContain("did not block, isolate or change anything");
    expect(text).toContain("Limitations");
    const events = await IncidentEvent.find({ orgId: oid(u.orgId), incidentId: oid(incident.id), kind: "report_generated" }).lean();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ format: "pdf" });

    const other = await registerUser(sa);
    expect((await request(sa.app).post(`${API}/incidents/${incident.id}/report/pdf`).set("Authorization", `Bearer ${other.token}`)).status).toBe(404);
    expect((await request(sa.app).post(`${API}/incidents/not-an-id/report/pdf`).set(auth)).status).toBe(400);
  });

  it("keeps the JSON report working after the refactor", async () => {
    const { auth, incident } = await seed();
    const res = await request(sa.app).post(`${API}/incidents/${incident.id}/report`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.incident.id).toBe(incident.id);
    expect(res.body.meta.reportVersion).toBe(1);
    expect(res.body.response.enforcement).toMatch(/did not block/);
  });
});

describe("PDF rendering", () => {
  it("replaces what the built-in fonts cannot draw and says so", async () => {
    expect(pdfSafe("a → b ≥ c")).toEqual({ text: "a -> b >= c", replaced: 0 });
    expect(pdfSafe("café – “quoted” · €5")).toEqual({ text: "café – “quoted” · €5", replaced: 0 });
    expect(pdfSafe("日本")).toEqual({ text: "??", replaced: 2 });
    const pdf = await renderPdf({ title: "Titre", footer: "foot", blocks: [{ kind: "paragraph", text: "Analyste: 日本" }] });
    const text = pdfText(pdf);
    expect(text).toContain("Analyste: ??");
    expect(text).toContain("2 character(s) outside the Latin-1 range");
  });

  it("paginates long tables and repeats the header", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => [`10.0.${Math.floor(i / 250)}.${i % 250}`, String(i * 3)]);
    const blocks: PdfBlock[] = [{ kind: "table", headers: ["Address", "Flows"], rows }];
    const pdf = await renderPdf({ title: "Long", footer: "foot", blocks });
    const pages = pdfPageCount(pdf);
    expect(pages).toBeGreaterThan(1);
    const text = pdfText(pdf);
    expect((text.match(/Address/g) ?? []).length).toBe(pages);
    expect(text).toContain("10.0.0.119");
    expect(text).toContain(`page ${pages} of ${pages}`);
  });

  it("describes an empty table instead of drawing nothing", async () => {
    const pdf = await renderPdf({ title: "Empty", footer: "foot", blocks: [{ kind: "table", headers: ["Source", "Count"], rows: [] }] });
    expect(pdfText(pdf)).toContain("None");
  });
});

describe("executive document blocks", () => {
  it("states the period, and what is absent, in words", async () => {
    expect(periodLabel({ from: null, to: null })).toBe("All stored data");
    expect(periodLabel({ from: "2017-07-07T03:00:00.000Z", to: null })).toBe("2017-07-07T03:00:00Z to now (UTC)");
    const u = await registerUser(sa);
    const report = await buildExecutiveReport(oid(u.orgId), {});
    const doc = executiveDocument(report);
    expect(doc.title).toBe("Executive report");
    const text = JSON.stringify(doc.blocks);
    expect(text).toContain("No flow in this period carries a ground-truth label");
    expect(text).toContain("No alert overlapped the period");
    expect(doc.footer).toMatch(/all times UTC/);
  });
});
