import { useEffect, useRef } from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { api } from "./api";
import type {
  AuditEntry,
  Dataset,
  Evaluation,
  Flow,
  Incident,
  Member,
  ModelDetail,
  ModelSummary,
  Overview,
  Page,
  ScoringStatus,
  SessionInfo,
  Timeseries,
  TopItem,
} from "./types";

export type FlowFilters = {
  verdict?: string;
  sourceKind?: string;
  sourceIp?: string;
  destinationIp?: string;
  protocol?: string;
  datasetId?: string;
  severity?: string;
  port?: string;
  needsReview?: string;
};

/** Query keys include the org so cached data is never shown under another org. */
function useOrgKey(): string {
  return useAuth().activeOrg?.id ?? "none";
}

export function useOverview(filters: FlowFilters = {}) {
  const org = useOrgKey();
  return useQuery({ queryKey: [org, "overview", filters], queryFn: () => api<Overview>("/stats/overview", { query: filters }) });
}

export function useTimeseries(filters: FlowFilters = {}) {
  const org = useOrgKey();
  return useQuery({ queryKey: [org, "timeseries", filters], queryFn: () => api<Timeseries>("/stats/timeseries", { query: filters }) });
}

export function useBreakdown(by: "verdict" | "severity" | "protocol" | "sourceKind" | "groundTruth", filters: FlowFilters = {}) {
  const org = useOrgKey();
  return useQuery({
    queryKey: [org, "breakdown", by, filters],
    queryFn: () => api<{ items: { key: string | null; count: number }[] }>("/stats/breakdown", { query: { ...filters, by } }),
  });
}

export function useTop(kind: "attackers" | "targets" | "ports" | "subnets", limit = 8) {
  const org = useOrgKey();
  return useQuery({ queryKey: [org, "top", kind, limit], queryFn: () => api<{ items: TopItem[] }>("/stats/top", { query: { kind, limit } }) });
}

export function useEvaluation(filters: FlowFilters = {}) {
  const org = useOrgKey();
  return useQuery({ queryKey: [org, "evaluation", filters], queryFn: () => api<Evaluation>("/stats/evaluation", { query: filters }) });
}

export function useFlows(filters: FlowFilters) {
  const org = useOrgKey();
  return useInfiniteQuery({
    queryKey: [org, "flows", filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page<Flow>>("/flows", { query: { ...filters, limit: 50, cursor: pageParam } }),
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

export function useFlow(id: string | null) {
  const org = useOrgKey();
  return useQuery({ queryKey: [org, "flow", id], queryFn: () => api<Flow>(`/flows/${id}`), enabled: Boolean(id) });
}

export function useDatasets() {
  const org = useOrgKey();
  return useQuery({
    queryKey: [org, "datasets"],
    queryFn: () => api<{ items: Dataset[] }>("/datasets"),
    // Poll while an import is running so its status flips without a reload.
    refetchInterval: (q) => (q.state.data?.items.some((d) => d.status === "Processing") ? 2000 : false),
  });
}

export function useModels() {
  const org = useOrgKey();
  return useQuery({ queryKey: [org, "models"], queryFn: () => api<{ items: ModelSummary[]; active: Record<string, string> }>("/models"), retry: 1 });
}

export function useModel(version: string | null) {
  const org = useOrgKey();
  return useQuery({ queryKey: [org, "model", version], queryFn: () => api<ModelDetail>(`/models/${encodeURIComponent(version ?? "")}`), enabled: Boolean(version) });
}

export function useScoringStatus() {
  const org = useOrgKey();
  const qc = useQueryClient();
  const lastScored = useRef<number | null>(null);
  const query = useQuery({
    queryKey: [org, "scoring"],
    queryFn: () => api<ScoringStatus>("/scoring/status"),
    // Poll while a run is going, or while an active model still has pending flows to score.
    refetchInterval: (q) => (q.state.data?.running || q.state.data?.schemas.some((s) => s.activeModel && s.pending > 0) ? 1500 : false),
  });
  const scored = query.data?.schemas.reduce((a, s) => a + s.scored + s.error, 0) ?? null;
  useEffect(() => {
    // New verdicts make every verdict-based view of this org stale.
    if (scored !== null && lastScored.current !== null && scored !== lastScored.current) {
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === org && q.queryKey[1] !== "scoring" });
    }
    lastScored.current = scored;
  }, [scored, org, qc]);
  return query;
}

export function useIncidents() {
  const org = useOrgKey();
  return useQuery({ queryKey: [org, "incidents"], queryFn: () => api<{ items: Incident[] }>("/incidents") });
}

export function useMembers() {
  const org = useOrgKey();
  return useQuery({ queryKey: [org, "members"], queryFn: () => api<{ items: Member[] }>("/members") });
}

export function useAudit(action?: string) {
  const org = useOrgKey();
  return useInfiniteQuery({
    queryKey: [org, "audit", action],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page<AuditEntry>>("/audit", { query: { limit: 50, cursor: pageParam, action } }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useSessions() {
  return useQuery({ queryKey: ["me", "sessions"], queryFn: () => api<{ items: SessionInfo[] }>("/auth/sessions") });
}

/** Mutation that invalidates the given org-scoped query families on success. */
export function useOrgMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, invalidate: string[]) {
  const qc = useQueryClient();
  const org = useOrgKey();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: [org, k] }))),
  });
}
