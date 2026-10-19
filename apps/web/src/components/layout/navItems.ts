import {
  LayoutDashboard,
  BarChart3,
  Globe2,
  Search,
  Radio,
  ShieldAlert,
  FileBarChart2,
  Database,
  BrainCircuit,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
}

// Shared between the desktop Sidebar and the mobile drawer nav (MobileNav)
// so the two never drift out of sync.
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/threat-intelligence", label: "Threat Intelligence", icon: Globe2 },
  { to: "/attack-explorer", label: "Attack Explorer", icon: Search },
  { to: "/real-time-monitor", label: "Real-Time Monitor", icon: Radio },
  { to: "/incidents", label: "Incidents", icon: ShieldAlert },
  { to: "/reports", label: "Reports", icon: FileBarChart2 },
  { to: "/datasets", label: "Datasets", icon: Database },
  { to: "/machine-learning", label: "Machine Learning", icon: BrainCircuit },
  { to: "/team", label: "Team", icon: Users, adminOnly: true },
  { to: "/settings", label: "Settings", icon: Settings },
];
