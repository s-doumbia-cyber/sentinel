import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { api } from "@/lib/api";
import type { Incident, IncidentStatus } from "@/lib/types";

/**
 * Changes an incident's status through the same PATCH the incident page uses (so it is audited and logged
 * like any other change). The board updates at once; if the API refuses, the previous list comes back.
 */
export function useMoveIncident() {
  const qc = useQueryClient();
  const org = useAuth().activeOrg?.id ?? "none";
  const key = [org, "incidents"];
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: IncidentStatus }) => api<Incident>(`/incidents/${id}`, { method: "PATCH", body: { status } }),
    onMutate: async ({ id, status }) => {
      // A refetch landing mid-move must not overwrite the optimistic state.
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<{ items: Incident[] }>(key);
      qc.setQueryData<{ items: Incident[] }>(key, (old) => old && { ...old, items: old.items.map((i) => (i.id === id ? { ...i, status } : i)) });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: (_data, _err, vars) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: key }),
        qc.invalidateQueries({ queryKey: [org, "incident", vars.id] }),
        qc.invalidateQueries({ queryKey: [org, "incidentTimeline"] }),
      ]),
  });
}
