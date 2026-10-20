import { describe, expect, it } from "vitest";
import { cn } from "./format";

describe("cn", () => {
  it("keeps a text colour and a custom text size together", () => {
    expect(cn("text-accent-contrast", "h-8 text-small")).toBe("text-accent-contrast h-8 text-small");
    expect(cn("text-small", "text-fg-1")).toBe("text-small text-fg-1");
    expect(cn("text-h1 font-semibold", "text-fg-1")).toBe("text-h1 font-semibold text-fg-1");
  });

  it("still lets a later utility of the same group win", () => {
    expect(cn("text-fg-1", "text-fg-2")).toBe("text-fg-2");
    expect(cn("text-small", "text-caption")).toBe("text-caption");
    expect(cn("shadow-e1", "shadow-e2")).toBe("shadow-e2");
  });
});
