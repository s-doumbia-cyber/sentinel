import { open } from "node:fs/promises";
import { AppError } from "./errors.js";

/** Multipart limits shared by every upload route: one file and a handful of short fields. */
export const MULTIPART_LIMITS = { files: 1, fields: 5, parts: 6, fieldSize: 1024, headerPairs: 100 } as const;

const SNIFF_BYTES = 64 * 1024;

/**
 * Content sniffing: the extension says .csv, the bytes must agree. A NUL byte or
 * invalid UTF-8 in the first 64 KB means a binary file (archive, executable, image).
 */
export async function assertTextFile(filePath: string): Promise<void> {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buf, 0, SNIFF_BYTES, 0);
    let sample = buf.subarray(0, bytesRead);
    if (sample.includes(0)) throw new AppError("UNSUPPORTED_MEDIA", 415, "The file is not a text CSV");
    // A multi-byte character may be cut at the end of the sample: drop up to 3 trailing bytes.
    for (let cut = 0; cut <= 3 && sample.length; cut++) {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(sample);
        return;
      } catch {
        if (bytesRead < SNIFF_BYTES) break;
        sample = sample.subarray(0, sample.length - 1);
      }
    }
    if (bytesRead === 0) return;
    throw new AppError("UNSUPPORTED_MEDIA", 415, "The file is not UTF-8 text");
  } finally {
    await handle.close();
  }
}
