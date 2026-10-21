# Sentinel — Performance

> Roadmap 5.4. How dashboard and stats endpoints stay fast at millions of flows, how it was
> measured, and what the numbers do and do not show.

## What makes the dashboards fast

1. **Minute rollups (`flow_rollups_1m`).** One row per minute and per combination of every
   dimension a stats filter can use (dataset, source kind, protocol, feature schema, score status,
   verdict, severity, needs-review, model version, ground truth). For malicious verdicts the row also
   keeps source, destination and destination port, so top attackers / targets / ports / subnets and
   the distinct-attacker count come from rollups too. Benign rows drop the endpoints to stay small.
2. **Exact, never stale.** Every write to flows bumps a per-org `version` (Mongoose hooks on insert,
   update, delete; explicit calls after `bulkWrite` and after raw-driver migrations). A rebuild records
   the version it started from; readers use the rollups only when `builtVersion === version`. Otherwise
   the request is answered from raw flows (correct, slower) and a rebuild is queued.
3. **Exact edges.** When a request has `from` / `to`, whole minutes come from the rollups and the
   partial minutes at each end from raw flows (one index range scan on `{orgId, timestamp}` each).
4. **Generations.** A rebuild writes a new generation of rows, switches the pointer, then deletes the
   old rows: a reader never mixes two builds. Rebuilds hold a lease in MongoDB (one per org at a time).
5. **Indexes.** Every flow query leads with `orgId`. Added this pass: `{orgId, createdAt}` (retention),
   a partial index on open alert claims, `{orgId, updatedAt}` on alerts. `GET /scoring/status` now uses
   one index count per (schema, status) instead of grouping every flow.

The response header `X-Sentinel-Stats-Source: rollup | raw` says which path answered.

## Benchmark

`npm run bench -w @sentinel/api -- --flows 3000000 --dbpath <empty dir> [--port 27118] [--runs 3] [--out file.md]`

- Starts its **own** mongod (the mongodb-memory-server binary) on a non-default port with its own data
  directory, refuses port 27017 and non-empty directories, and deletes the directory at the end. It
  never reads `.env` and never connects to another database.
- Inserts synthetic flows from a seeded generator (`src/scripts/bench.ts`): five 8-hour days like
  CICIDS2017, 80 % benign, 20 % attacks (DDoS, PortScan over 1,000 ports, DoS Hulk, SSH and FTP brute
  force), 5 % unscored, a synthetic "model" right 97 % of the time. No feature vectors (stats never
  read them), so documents are smaller than real imports; no real CICIDS rows.
- Times each endpoint through the real Express app (in-process, supertest, no network), first with no
  rollups (raw flows), then after one rebuild.

### Results

Measured 2026-10-21/22 on the owner's laptop (Windows 11, Node 24.18, MongoDB 7.0.24 from the
mongodb-memory-server binary, WiredTiger cache capped at 2 GB), 3,000,000 synthetic flows.

Two runs with the same seed: the raw column comes from run A (3 runs per endpoint; it stopped after the
stats endpoints because its access token expired, a script bug fixed since), the rollup column from
run B (`--rollup-only`, 5 runs per endpoint). The raw code path did not change between the runs.
Insert took about 300 s; the rollup rebuild **47.4 s** and produced **352,359 rows** (8.5 flows per row).

| Endpoint | Raw p50 | Raw p95 | Rollup p50 | Rollup p95 | Speed-up (p50) |
|---|---|---|---|---|---|
| Overview KPIs | 40,330 ms | 40,732 ms | 2,057 ms | 2,219 ms | 19.6× |
| Overview, one day (partial-minute edges) | 10,348 ms | 10,654 ms | 442 ms | 469 ms | 23.4× |
| Verdict breakdown | 15,715 ms | 15,790 ms | 1,345 ms | 1,545 ms | 11.7× |
| Ground-truth breakdown | 14,897 ms | 15,109 ms | 1,394 ms | 1,409 ms | 10.7× |
| Timeseries | 25,948 ms | 26,359 ms | 2,549 ms | 2,793 ms | 10.2× |
| Top attackers | 28,765 ms | 29,858 ms | 1,598 ms | 1,638 ms | 18.0× |
| Top ports | 18,279 ms | 18,614 ms | 2,356 ms | 2,470 ms | 7.8× |
| Top subnets | 25,487 ms | 30,086 ms | 3,438 ms | 3,549 ms | 7.4× |
| Evaluation (confusion matrix) | 20,409 ms | 20,833 ms | 2,580 ms | 2,627 ms | 7.9× |
| Flow list, first page | not measured in run A | | 24 ms | 38 ms | (not a stats endpoint) |
| Flow list, malicious, first page | not measured in run A | | 25 ms | 46 ms | (not a stats endpoint) |
| Scoring status (index counts) | not measured in run A | | 2,155 ms | 2,310 ms | (not a stats endpoint) |

**Verdict: the target is not met.** Rollups make the dashboards 7–23× faster, but at 3 M flows the
stats endpoints still take 0.4–3.5 s p50 on this machine, against p95 < 300 ms at 5 M flows in
PRODUCT_SPEC §6. List endpoints (cursor pagination on indexes) are well inside their 800 ms target.

Why, and what would close the gap (not done):

- 352 k rollup rows is too many: the synthetic port scan and the 3 % "wrong verdict" benign flows
  keep a source / destination / port per malicious row and minute. Splitting rollups into a counts
  table (no endpoints, roughly 30 rows per minute) and a separate endpoints table, or hour buckets
  for the endpoints, should cut the counter queries by an order of magnitude.
- Each request runs several aggregations over all rows of the org; a 15–60 s cache of the hot
  answers (ARCHITECTURE §8) would remove most of them for a dashboard that refreshes.
- `GET /scoring/status` counts 3 M index keys per status; it should read the rollups too.
- Timings were taken with a 2 GB WiredTiger cache on a busy laptop; a server would be faster, but
  the rows-scanned problem above would remain.

### Reading these numbers

- One laptop, Windows 11, MongoDB on the same machine (2 GB WiredTiger cache), other work running at
  the same time (an IDE, other sessions). Not a server benchmark: compare the two
  columns, not the absolute values with other systems.
- The target in `docs/PRODUCT_SPEC.md` §6 is dashboard p95 < 300 ms **at 5 million flows**; this run
  used 3 million (the size of the full CICIDS2017 export). See the verdict under the table.
- Raw numbers are what an org sees right after an import or scoring run, until the rollup rebuild
  (timed above) finishes.
- Synthetic data has fewer distinct values than some real traffic (e.g. scans across 65,535 ports or
  many sources): rollup size, and so rollup query time, grows with distinct malicious endpoints per
  minute.

## Not done

- No Redis cache for hot aggregates (ARCHITECTURE §8); the numbers above show it is still needed.
- No `alert_rollups_1m`: alert lists are small and paginated.
- Rebuilds are full per org (47 s at 3 M flows). Incremental rollups would cut that but are much
  harder to keep exact.
- Ingest throughput (≥ 1,500 flows/s, roadmap 2.1) is not measured here: there is no ingest endpoint yet.
