/** Browser-safe IP check (node:net is not available in the web app). */
export function isIP(value: string): boolean {
  if (/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value)) return true;
  if (!value.includes(":") || !/^[0-9a-fA-F:.]+$/.test(value)) return false;
  // IPv6: at most one "::", at most eight groups of up to four hex digits.
  const parts = value.split("::");
  if (parts.length > 2) return false;
  const groups = parts.flatMap((p) => (p ? p.split(":") : []));
  if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return parts.length === 2 ? groups.length < 8 : groups.length === 8;
}
