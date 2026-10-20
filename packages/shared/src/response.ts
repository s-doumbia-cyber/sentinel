import { isIP } from "./net.js";
import type { AttackClass } from "./taxonomy.js";

// ---- Kill-chain stages (context for correlation, never proof) ---------------------------

export const STAGES = ["Discovery", "Credential access", "Exploitation", "Command and control", "Impact"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_BY_CLASS: Partial<Record<AttackClass, Stage>> = {
  PortScan: "Discovery",
  FTPPatator: "Credential access",
  SSHPatator: "Credential access",
  WebAttack: "Exploitation",
  XSS: "Exploitation",
  SQLInjection: "Exploitation",
  Heartbleed: "Exploitation",
  Infiltration: "Exploitation",
  Botnet: "Command and control",
  DDoS: "Impact",
  DoSHulk: "Impact",
  DoSSlowloris: "Impact",
  DoSGoldenEye: "Impact",
};

export function stageOrder(stage: Stage): number {
  return STAGES.indexOf(stage);
}

// ---- Knowledge base (static, versioned with the code) -----------------------------------

export interface KnowledgeEntry {
  summary: string;
  whyItMatters: string;
  /** Investigation steps: how an analyst can confirm or rule out the detection. */
  confirm: string[];
  /** Containment ideas for a human to evaluate; Sentinel applies none of them. */
  contain: string[];
  references: { label: string; url: string }[];
}

const attack = (id: string) => ({ label: `MITRE ATT&CK ${id}`, url: `https://attack.mitre.org/techniques/${id}/` });

export const KNOWLEDGE_BASE_VERSION = "2026.10.20";

export const KNOWLEDGE_BASE: Partial<Record<AttackClass, KnowledgeEntry>> = {
  PortScan: {
    summary: "One address probed many ports or services in a short time.",
    whyItMatters: "Scanning often precedes an attack; it can also be an authorised inventory or vulnerability scan.",
    confirm: [
      "Check whether the source is a known scanner (IT inventory, vulnerability management).",
      "List which destination ports answered (flows with packets in both directions) to see what was exposed.",
      "Look for follow-up activity from the same source on the ports that answered.",
    ],
    contain: [
      "If unauthorised, consider restricting the source at the perimeter firewall after review.",
      "Reduce exposed services found during the scan.",
    ],
    references: [attack("T1046")],
  },
  SSHPatator: {
    summary: "Many short SSH connections from one source to one server, consistent with password guessing.",
    whyItMatters: "A successful guess gives interactive access to the server.",
    confirm: [
      "Check the server's authentication log (e.g. /var/log/auth.log) for failed and successful logins from the source.",
      "Check whether any account logged in successfully during or after the burst.",
      "Confirm the source is not an automation or monitoring account.",
    ],
    contain: [
      "Consider rate limiting or temporarily blocking the source after review.",
      "Enforce key-based authentication or MFA; disable password login where possible.",
      "Reset credentials of any account with a successful login from the source.",
    ],
    references: [attack("T1110")],
  },
  FTPPatator: {
    summary: "Many short FTP connections from one source to one server, consistent with password guessing.",
    whyItMatters: "FTP sends credentials in clear text; a successful guess exposes stored files.",
    confirm: ["Check the FTP server log for failed and successful logins from the source.", "Check for file transfers after a successful login."],
    contain: ["Consider blocking the source after review.", "Replace FTP with SFTP and rotate exposed credentials."],
    references: [attack("T1110")],
  },
  DDoS: {
    summary: "Traffic volume or pattern consistent with a (distributed) denial of service.",
    whyItMatters: "Service availability is affected; flows alone cannot show whether the service actually went down.",
    confirm: [
      "Check service health and response times for the target during the window.",
      "Compare volume with the target's normal baseline.",
      "Check whether many sources are involved (distributed) or one (single-source flood).",
    ],
    contain: ["Coordinate with the upstream provider or DDoS protection service.", "Rate-limit at the edge after review."],
    references: [attack("T1498")],
  },
  DoSHulk: {
    summary: "High-rate HTTP requests consistent with an application-layer flood.",
    whyItMatters: "Can exhaust web server workers without large bandwidth.",
    confirm: ["Check web server access logs for request rate and user agents from the source.", "Check server resource usage during the window."],
    contain: ["Consider rate limiting per client at the web server or reverse proxy."],
    references: [attack("T1499")],
  },
  DoSGoldenEye: {
    summary: "HTTP keep-alive abuse consistent with the GoldenEye DoS tool.",
    whyItMatters: "Holds connections open to exhaust the server.",
    confirm: ["Check web server connection counts and keep-alive settings during the window."],
    contain: ["Tune keep-alive timeouts and per-client connection limits after review."],
    references: [attack("T1499")],
  },
  DoSSlowloris: {
    summary: "Long, slow connections to a web server consistent with Slowloris-style DoS.",
    whyItMatters: "A few clients can exhaust connection slots.",
    confirm: ["Check the web server for many half-open or slow requests from the source."],
    contain: ["Lower request header timeouts and limit connections per client after review."],
    references: [attack("T1499")],
  },
  WebAttack: {
    summary: "Requests consistent with attacks against a web application.",
    whyItMatters: "Can lead to account takeover or data exposure.",
    confirm: ["Inspect web application logs for the requests from the source.", "Check whether responses indicate success (status codes, response sizes)."],
    contain: ["Patch or harden the application; consider WAF rules after review."],
    references: [attack("T1190")],
  },
  XSS: {
    summary: "Traffic consistent with cross-site scripting attempts.",
    whyItMatters: "Can execute script in other users' browsers.",
    confirm: ["Inspect application logs for script payloads in parameters.", "Test whether the targeted page reflects input unsafely."],
    contain: ["Fix output encoding; add a Content Security Policy."],
    references: [attack("T1190")],
  },
  SQLInjection: {
    summary: "Traffic consistent with SQL injection attempts.",
    whyItMatters: "Can expose or modify database contents.",
    confirm: ["Inspect application and database logs for injected queries.", "Check for unusual data access or large responses."],
    contain: ["Fix the vulnerable query (parameterisation); rotate credentials if data access is suspected."],
    references: [attack("T1190")],
  },
  Heartbleed: {
    summary: "Traffic consistent with exploitation of CVE-2014-0160 (OpenSSL Heartbleed).",
    whyItMatters: "Can leak server memory, including private keys.",
    confirm: ["Check the OpenSSL version of the target service."],
    contain: ["Patch OpenSSL, revoke and reissue certificates, rotate secrets."],
    references: [attack("T1190"), { label: "CVE-2014-0160", url: "https://nvd.nist.gov/vuln/detail/CVE-2014-0160" }],
  },
  Botnet: {
    summary: "Traffic consistent with a host communicating with botnet command and control.",
    whyItMatters: "Suggests the internal host may be compromised.",
    confirm: ["Check the internal host with endpoint tools for unknown processes.", "Check DNS logs for the domains contacted."],
    contain: ["Consider isolating the host through your endpoint tooling after review."],
    references: [attack("T1071")],
  },
  Infiltration: {
    summary: "Activity consistent with an attacker operating inside the network.",
    whyItMatters: "Suggests a foothold beyond the perimeter.",
    confirm: ["Review the host's recent logins and processes.", "Look for lateral connections from the host to other internal systems."],
    contain: ["Escalate to incident response; consider isolating affected hosts after review."],
    references: [{ label: "MITRE ATT&CK TA0008 Lateral Movement", url: "https://attack.mitre.org/tactics/TA0008/" }],
  },
};

// ---- Blocklist simulation -------------------------------------------------------------------

export const BLOCKLIST_FORMATS = ["iptables", "nftables", "csv"] as const;
export type BlocklistFormat = (typeof BLOCKLIST_FORMATS)[number];

/** Comments end up in shell commands: keep a conservative character set. */
export function sanitizeComment(comment: string): string {
  return comment.replace(/[^A-Za-z0-9 _.:-]/g, "").trim().slice(0, 60) || "sentinel";
}

/**
 * Generates firewall snippets for a human to review. Sentinel never applies
 * them: there is no enforcement integration.
 */
export function generateBlocklist(ips: string[], format: BlocklistFormat, comment: string): string {
  const list = [...new Set(ips)];
  for (const ip of list) if (!isIP(ip)) throw new Error(`Invalid IP address: ${ip}`);
  const c = sanitizeComment(comment);
  if (format === "iptables") {
    return list.map((ip) => `${ip.includes(":") ? "ip6tables" : "iptables"} -I INPUT -s ${ip} -j DROP -m comment --comment "${c}"`).join("\n") + "\n";
  }
  if (format === "nftables") {
    const v4 = list.filter((ip) => !ip.includes(":"));
    const v6 = list.filter((ip) => ip.includes(":"));
    const lines = [`# ${c}`, "table inet sentinel_blocklist {"];
    if (v4.length) lines.push("  set blocked_v4 {", "    type ipv4_addr", `    elements = { ${v4.join(", ")} }`, "  }");
    if (v6.length) lines.push("  set blocked_v6 {", "    type ipv6_addr", `    elements = { ${v6.join(", ")} }`, "  }");
    lines.push("  chain input {", "    type filter hook input priority 0; policy accept;");
    if (v4.length) lines.push("    ip saddr @blocked_v4 drop");
    if (v6.length) lines.push("    ip6 saddr @blocked_v6 drop");
    lines.push("  }", "}");
    return lines.join("\n") + "\n";
  }
  return ["ip,comment", ...list.map((ip) => `${ip},${c}`)].join("\n") + "\n";
}
