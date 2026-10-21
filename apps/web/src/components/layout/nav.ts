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
import type { Translation } from "@/i18n/en";

export type NavKey = keyof Translation["nav"]["pages"];
export type NavGroup = keyof Translation["nav"]["groups"];

export interface NavItem {
  to: string;
  /** Translation key under `nav.pages`; `label` stays English for search and tests. */
  key: NavKey;
  label: string;
  icon: LucideIcon;
  /** Hidden (cosmetically) for roles without this permission; the API enforces it. */
  requires?: Action;
  /** Pressed after "G" to go here (see the shortcuts overlay). */
  go?: string;
}

/** Only pages backed by a working API appear here; nothing links to a placeholder. */
export const NAV: { group: NavGroup; items: NavItem[] }[] = [
  {
    group: "Monitor",
    items: [
      { to: "/", key: "overview", label: "Command Center", icon: LayoutDashboard, go: "o" },
      { to: "/alerts", key: "alerts", label: "Alerts", icon: Bell, go: "a" },
      { to: "/flows", key: "flows", label: "Flows", icon: ListTree, go: "f" },
    ],
  },
  {
    group: "Investigate",
    items: [
      { to: "/incidents", key: "incidents", label: "Incidents", icon: ShieldAlert, go: "i" },
      { to: "/assets", key: "assets", label: "Assets", icon: Server, go: "h" },
    ],
  },
  {
    group: "Detect",
    items: [
      { to: "/rules", key: "rules", label: "Rules", icon: ListChecks, go: "r" },
      { to: "/models", key: "models", label: "Models", icon: FlaskConical, go: "m" },
      { to: "/validation", key: "validation", label: "Validation", icon: Beaker, go: "v" },
      { to: "/datasets", key: "datasets", label: "Datasets", icon: Database, go: "d" },
    ],
  },
  {
    group: "Manage",
    items: [
      { to: "/identity", key: "identity", label: "Identity sources", icon: Fingerprint, requires: "identity:read", go: "p" },
      { to: "/reports", key: "reports", label: "Reports", icon: FileText, go: "e" },
      { to: "/team", key: "team", label: "Team", icon: Users, go: "t" },
      { to: "/audit", key: "audit", label: "Audit log", icon: ScrollText, requires: "audit:read", go: "u" },
      { to: "/system", key: "system", label: "System", icon: Activity, requires: "jobs:read", go: "y" },
      { to: "/settings", key: "settings", label: "Settings", icon: Settings, go: "s" },
    ],
  },
];
