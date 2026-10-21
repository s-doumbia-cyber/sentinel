import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { api } from "@/lib/api";
import type { ExecutiveReport } from "@/lib/types";

/** Keyed by org and range, so another organisation's report is never shown from cache. */
export function useExecutiveReport(range: { from?: string; to?: string }, enabled = true) {
  const org = useAuth().activeOrg?.id ?? "none";
  return useQuery({ queryKey: [org, "executiveReport", range], queryFn: () => api<ExecutiveReport>("/reports/executive", { query: range }), enabled });
}
