import { describe, expect, it } from "vitest";
import { inviteLink } from "./teamApi";

describe("inviteLink", () => {
  it("puts the token in the fragment, which is never sent to a server or in a Referer", () => {
    const url = new URL(inviteLink("A".repeat(43)));
    expect(url.pathname).toBe("/accept-invite");
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#${"A".repeat(43)}`);
  });
});
