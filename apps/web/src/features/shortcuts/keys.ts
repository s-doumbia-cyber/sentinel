import { isIP } from "@sentinel/shared";

/** True when the keystroke belongs to a form control, so single-letter shortcuts must stay out of the way. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.getAttribute("role") === "textbox";
}

/** A dialog (drawer, palette, confirmation) owns the keyboard while it is open. */
export function dialogIsOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

export type QueryKind =
  | { kind: "empty" }
  | { kind: "ip"; value: string }
  | { kind: "partial-ip"; value: string }
  | { kind: "id"; value: string }
  | { kind: "text"; value: string };

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const PARTIAL_IP = /^(\d{1,3}\.){1,3}\d{0,3}$|^[0-9a-f]{1,4}(:[0-9a-f]{0,4})+$/i;

/** Decides what the palette should look up for what was typed. */
export function classifyQuery(raw: string): QueryKind {
  const value = raw.trim();
  if (!value) return { kind: "empty" };
  if (isIP(value)) return { kind: "ip", value };
  if (OBJECT_ID.test(value)) return { kind: "id", value: value.toLowerCase() };
  if (PARTIAL_IP.test(value)) return { kind: "partial-ip", value };
  return { kind: "text", value };
}

export interface ShortcutRow {
  keys: string[];
  /** "then" between keys means a sequence, "or" means alternatives. */
  join?: "then" | "or" | "plus";
  label: string;
}

export const SHORTCUT_GROUPS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: "Anywhere",
    rows: [
      { keys: ["Ctrl", "K"], join: "plus", label: "Open the command palette (Cmd+K on macOS)" },
      { keys: ["?"], label: "Show this list" },
      { keys: ["Esc"], label: "Close the palette, a dialog or the alert panel" },
    ],
  },
  {
    title: "Go to a page",
    rows: [
      { keys: ["G", "O"], join: "then", label: "Command Center (overview)" },
      { keys: ["G", "A"], join: "then", label: "Alerts" },
      { keys: ["G", "I"], join: "then", label: "Incidents" },
      { keys: ["G", "F"], join: "then", label: "Flows" },
      { keys: ["G", "H"], join: "then", label: "Assets (hosts)" },
      { keys: ["G", "R"], join: "then", label: "Rules" },
      { keys: ["G", "M"], join: "then", label: "Models" },
      { keys: ["G", "V"], join: "then", label: "Validation" },
      { keys: ["G", "D"], join: "then", label: "Datasets" },
      { keys: ["G", "E"], join: "then", label: "Executive report" },
      { keys: ["G", "P"], join: "then", label: "Identity sources (Analysts and above)" },
      { keys: ["G", "T"], join: "then", label: "Team" },
      { keys: ["G", "U"], join: "then", label: "Audit log (Owners and Admins)" },
      { keys: ["G", "S"], join: "then", label: "Settings" },
    ],
  },
  {
    title: "Alert list",
    rows: [
      { keys: ["J", "↓"], join: "or", label: "Next alert" },
      { keys: ["K", "↑"], join: "or", label: "Previous alert" },
      { keys: ["Enter"], label: "Open the focused alert" },
    ],
  },
  {
    title: "Open alert panel (Analysts and above)",
    rows: [
      { keys: ["E"], label: "Acknowledge the alert" },
      { keys: ["F"], label: "Mark as false positive (press again to clear)" },
      { keys: ["I"], label: "Open its incident, or create one from the alert" },
    ],
  },
  {
    title: "Graph",
    rows: [
      { keys: ["Arrow keys"], label: "Pan (when the graph is focused)" },
      { keys: ["+", "-"], join: "or", label: "Zoom in or out" },
      { keys: ["0"], label: "Reset the layout" },
    ],
  },
];
