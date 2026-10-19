import type { AttackClass } from "./taxonomy.js";

export interface MitreMapping {
  /** Technique id, e.g. T1046. `null` when no single technique fits. */
  techniqueId: string | null;
  techniqueName: string | null;
  tactics: { id: string; name: string }[];
  /** Mappings are heuristics from the attack class, always displayed as "suggested". */
  suggested: true;
  note?: string;
}

const IMPACT = { id: "TA0040", name: "Impact" };

/** docs/ML_AND_DETECTION.md §3. `Normal` has no mapping. */
export const MITRE_BY_CLASS: Partial<Record<AttackClass, MitreMapping>> = {
  PortScan: {
    techniqueId: "T1046",
    techniqueName: "Network Service Discovery",
    tactics: [{ id: "TA0007", name: "Discovery" }],
    suggested: true,
  },
  FTPPatator: {
    techniqueId: "T1110",
    techniqueName: "Brute Force",
    tactics: [{ id: "TA0006", name: "Credential Access" }],
    suggested: true,
  },
  SSHPatator: {
    techniqueId: "T1110",
    techniqueName: "Brute Force",
    tactics: [{ id: "TA0006", name: "Credential Access" }],
    suggested: true,
  },
  DDoS: { techniqueId: "T1498", techniqueName: "Network Denial of Service", tactics: [IMPACT], suggested: true },
  DoSHulk: { techniqueId: "T1499", techniqueName: "Endpoint Denial of Service", tactics: [IMPACT], suggested: true },
  DoSSlowloris: {
    techniqueId: "T1499",
    techniqueName: "Endpoint Denial of Service",
    tactics: [IMPACT],
    suggested: true,
  },
  DoSGoldenEye: {
    techniqueId: "T1499",
    techniqueName: "Endpoint Denial of Service",
    tactics: [IMPACT],
    suggested: true,
  },
  WebAttack: {
    techniqueId: "T1190",
    techniqueName: "Exploit Public-Facing Application",
    tactics: [{ id: "TA0001", name: "Initial Access" }],
    suggested: true,
  },
  XSS: {
    techniqueId: "T1190",
    techniqueName: "Exploit Public-Facing Application",
    tactics: [{ id: "TA0001", name: "Initial Access" }],
    suggested: true,
  },
  SQLInjection: {
    techniqueId: "T1190",
    techniqueName: "Exploit Public-Facing Application",
    tactics: [{ id: "TA0001", name: "Initial Access" }],
    suggested: true,
  },
  Heartbleed: {
    techniqueId: "T1190",
    techniqueName: "Exploit Public-Facing Application",
    tactics: [{ id: "TA0001", name: "Initial Access" }],
    suggested: true,
  },
  Botnet: {
    techniqueId: "T1071",
    techniqueName: "Application Layer Protocol",
    tactics: [{ id: "TA0011", name: "Command and Control" }],
    suggested: true,
  },
  Infiltration: {
    techniqueId: null,
    techniqueName: null,
    tactics: [
      { id: "TA0008", name: "Lateral Movement" },
      { id: "TA0010", name: "Exfiltration" },
    ],
    suggested: true,
    note: "No single technique fits; tactics are context hints only.",
  },
};
