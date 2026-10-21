import { inflateSync } from "node:zlib";

/**
 * Reads the text back out of a PDF written by pdfkit with the built-in fonts: streams are Flate-compressed
 * and every string is a hex-encoded WinAnsi run inside a TJ / Tj operator. Good enough to assert on content.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const lines: string[] = [];
  let at = 0;
  for (;;) {
    const start = raw.indexOf("stream", at);
    if (start === -1) break;
    const dataStart = raw.indexOf("\n", start) + 1;
    const end = raw.indexOf("endstream", dataStart);
    if (end === -1) break;
    at = end + 9;
    let content: string;
    try {
      content = inflateSync(pdf.subarray(dataStart, end)).toString("latin1");
    } catch {
      content = raw.slice(dataStart, end);
    }
    for (const m of content.matchAll(/(\[[^\]]*\]|<[0-9a-fA-F]*>)\s*(?:TJ|Tj)/g)) {
      const hex = [...(m[1] ?? "").matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1] ?? "", "hex").toString("latin1")).join("");
      if (hex) lines.push(hex);
    }
  }
  return lines.join("\n");
}

export const pdfPageCount = (pdf: Buffer): number => (pdf.toString("latin1").match(/\/Type \/Page(?!s)/g) ?? []).length;
