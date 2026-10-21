import { describe, expect, it } from "vitest";
import { classifyQuery, dialogIsOpen, isEditableTarget } from "./keys";

describe("classifyQuery", () => {
  it.each([
    ["", { kind: "empty" }],
    ["   ", { kind: "empty" }],
    ["10.0.0.66", { kind: "ip", value: "10.0.0.66" }],
    ["  2001:db8::1 ", { kind: "ip", value: "2001:db8::1" }],
    ["64f1c0a2b3c4d5e6f7a8b9c0", { kind: "id", value: "64f1c0a2b3c4d5e6f7a8b9c0" }],
    ["64F1C0A2B3C4D5E6F7A8B9C0", { kind: "id", value: "64f1c0a2b3c4d5e6f7a8b9c0" }],
    ["10.0.0", { kind: "partial-ip", value: "10.0.0" }],
    ["192.168.", { kind: "partial-ip", value: "192.168." }],
    ["port scan", { kind: "text", value: "port scan" }],
    ["999.1.1.1", { kind: "partial-ip", value: "999.1.1.1" }],
    ["64f1c0a2b3c4d5e6f7a8b9c", { kind: "text", value: "64f1c0a2b3c4d5e6f7a8b9c" }],
  ])("reads %j", (input, expected) => {
    expect(classifyQuery(input)).toEqual(expected);
  });
});

describe("isEditableTarget", () => {
  it("is true for form controls and editable regions only", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    editable.setAttribute("role", "textbox");
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("dialogIsOpen", () => {
  it("sees an open dialog", () => {
    expect(dialogIsOpen()).toBe(false);
    const d = document.createElement("div");
    d.setAttribute("role", "dialog");
    document.body.append(d);
    expect(dialogIsOpen()).toBe(true);
    d.remove();
  });
});
