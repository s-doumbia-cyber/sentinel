import {
  Activity,
  Bell,
  Database,
  Fingerprint,
  Beaker,
  Server,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  FileText,
  ListTree,
  ScrollText,
  Settings,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Action } from "@sentinel/shared";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Hidden (cosmetically) for roles without this permission; the API enforces it. */
  requires?: Action;
  /** Pressed after "G" to go here (see the shortcuts overlay). */
  go?: string;
}

/** Only pages backed by a working API appear here; nothing links to a placeholder. */
export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Monitor",
    items: [
      { to: "/", label: "Command Center", icon: LayoutDashboard, go: "o" },
      { to: "/alerts", label: "Alerts", icon: Bell, go: "a" },
      { to: "/flows", label: "Flows", icon: ListTree, go: "f" },
    ],
  },
  {
    group: "Investigate",
    items: [
      { to: "/incidents", label: "Incidents", icon: ShieldAlert, go: "i" },
      { to: "/assets", label: "Assets", icon: Server, go: "h" },
    ],
  },
  {
    group: "Detect",
    items: [
      { to: "/rules", label: "Rules", icon: ListChecks, go: "r" },
      { to: "/models", label: "Models", icon: FlaskConical, go: "m" },
      { to: "/validation", label: "Validation", icon: Beaker, go: "v" },
      { to: "/datasets", label: "Datasets", icon: Database, go: "d" },
    ],
  },
  {
    group: "Manage",
    items: [
      { to: "/identity", label: "Identity sources", icon: Fingerprint, requires: "identity:read", go: "p" },
      { to: "/reports", label: "Reports", icon: FileText, go: "e" },
      { to: "/team", label: "Team", icon: Users, go: "t" },
      { to: "/audit", label: "Audit log", icon: ScrollText, requires: "audit:read", go: "u" },
      { to: "/system", label: "System", icon: Activity, requires: "jobs:read", go: "y" },
      { to: "/settings", label: "Settings", icon: Settings, go: "s" },
    ],
  },
];
