import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { Dataset } from "../src/models/tenant.js";
import { API, CICIDS_HEADER, buildApp, oid, registerUser } from "./helpers.js";

const sa = buildApp();

function tempFile(content: Buffer | string, ext = ".csv"): string {
  const file = path.join(tmpdir(), `sentinel-upload-test-${randomBytes(6).toString("hex")}${ext}`);
  writeFileSync(file, content);
  return file;
}

describe("upload hardening", () => {
  it("refuses binary content renamed to .csv, before any dataset is created", async () => {
    const u = await registerUser(sa);
    // A ZIP header followed by the real CSV header: the extension and the first line look fine.
    const zipLike = Buffer.concat([Buffer.from(`${CICIDS_HEADER.join(",")}\n`), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x14])]);
    const res = await request(sa.app).post(`${API}/imports/csv`).set("Authorization", `Bearer ${u.token}`).attach("file", tempFile(zipLike));
    expect(res.status).toBe(415);
    expect(await Dataset.countDocuments({ orgId: oid(u.orgId) })).toBe(0);
  });

  it("refuses invalid UTF-8, other extensions and extra files", async () => {
    const u = await registerUser(sa);
    const auth = { Authorization: `Bearer ${u.token}` };
    const latin1 = Buffer.concat([Buffer.from(`${CICIDS_HEADER.join(",")}\n`), Buffer.from([0xe9, 0xe8, 0x0a])]);
    expect((await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", tempFile(latin1))).status).toBe(415);
    expect((await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", tempFile("a,b\n", ".exe"))).status).toBe(415);
    const two = await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", tempFile("a\n")).attach("file", tempFile("b\n"));
    expect(two.status).toBe(400);
  });

  it("applies the same checks to identity imports", async () => {
    const u = await registerUser(sa);
    const res = await request(sa.app)
      .post(`${API}/identity/imports`)
      .set("Authorization", `Bearer ${u.token}`)
      .attach("file", tempFile(Buffer.from([0x69, 0x70, 0x2c, 0x00, 0x01])));
    expect(res.status).toBe(415);
  });
});
