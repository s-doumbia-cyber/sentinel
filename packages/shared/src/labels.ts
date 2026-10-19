import { ATTACK_CLASSES, type AttackClass } from "./taxonomy.js";

/**
 * Collapses a raw dataset label to lowercase words so encoding accidents in
 * CICIDS2017 ("Web Attack � Brute Force", "Web Attack – XSS") and
 * punctuation differences ("FTP-Patator") all compare the same way.
 */
function clean(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Ordered: the first matching pattern wins. Each pattern is anchored so a
// label is only accepted when it matches a known spelling as a whole, never
// because it happens to contain a keyword (an earlier substring-based version
// would have accepted any label containing "bot" or "ftp").
const PATTERNS: ReadonlyArray<readonly [RegExp, AttackClass]> = [
  [/^(benign|normal)$/, "Normal"],
  [/^ddos( loit)?$/, "DDoS"],
  [/^dos ?hulk$/, "DoSHulk"],
  [/^dos ?goldeneye$/, "DoSGoldenEye"],
  // CICIDS2017 records slowhttptest separately; both are slow-request DoS and
  // the taxonomy has a single class for them (decision logged in ROADMAP.md).
  [/^dos ?(slowloris|slowhttptest)$/, "DoSSlowloris"],
  [/^ftp ?patator$/, "FTPPatator"],
  [/^ssh ?patator$/, "SSHPatator"],
  [/^port ?scan$/, "PortScan"],
  [/^(bot|botnet)$/, "Botnet"],
  [/^infiltration$/, "Infiltration"],
  [/^heartbleed$/, "Heartbleed"],
  [/^web ?attack( .*)? brute force$/, "WebAttack"],
  [/^web ?attack$/, "WebAttack"],
  [/^(web ?attack( .*)? )?xss$/, "XSS"],
  [/^(web ?attack( .*)? )?sql ?injection$/, "SQLInjection"],
];

const CANONICAL_BY_CLEAN = new Map<string, AttackClass>(ATTACK_CLASSES.map((c) => [clean(c), c]));

/**
 * Maps a raw dataset label to the canonical taxonomy.
 *
 * Returns `null` for anything unrecognised: the caller must skip and log the
 * row. Unknown labels are never defaulted into a class (CLAUDE.md §3.4 —
 * a silent default once produced 700k fake "Infiltration" rows).
 */
export function normalizeLabel(raw: unknown): AttackClass | null {
  if (typeof raw !== "string") return null;
  const c = clean(raw);
  if (!c) return null;
  const canonical = CANONICAL_BY_CLEAN.get(c);
  if (canonical) return canonical;
  for (const [pattern, cls] of PATTERNS) {
    if (pattern.test(c)) return cls;
  }
  return null;
}
