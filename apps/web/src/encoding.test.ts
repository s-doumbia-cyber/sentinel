import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A file saved in Windows-1252 shows "�" in the UI instead of "·" or quotes (found in two pages).
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(tsx?|css|json)$/.test(name) ? [path] : [];
  });
}

describe("source encoding", () => {
  it("every web source file is valid UTF-8", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const bad = sources(join(__dirname)).filter((f) => {
      try {
        decoder.decode(readFileSync(f));
        return false;
      } catch {
        return true;
      }
    });
    expect(bad).toEqual([]);
  });
});
