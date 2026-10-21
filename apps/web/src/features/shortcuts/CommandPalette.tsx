import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Bell, CornerDownLeft, Keyboard, ListTree, Search, Server, ShieldAlert, SunMoon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { NAV } from "@/components/layout/nav";
import { useAuth } from "@/features/auth/AuthContext";
import { api } from "@/lib/api";
import type { Alert, Asset, Flow, Incident, Page } from "@/lib/types";
import { classifyQuery } from "./keys";
import { useToggleTheme } from "./useToggleTheme";

const item =
  "flex min-h-[40px] cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-small text-fg-2 outline-none data-[selected=true]:bg-surface-3 data-[selected=true]:text-fg-1";
const group = "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.04em] [&_[cmdk-group-heading]]:text-fg-3";

/** Looks an id up with the same read endpoints the pages use, so the API's RBAC and org scope decide what exists. */
function useExists<T>(path: string, enabled: boolean) {
  const org = useAuth().activeOrg?.id ?? "none";
  return useQuery({ queryKey: [org, "palette", path], queryFn: () => api<T>(path), enabled, retry: false, staleTime: 30_000 });
}

function Row({ icon, children, hint }: { icon: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <>
      <span aria-hidden className="text-fg-3">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-caption text-fg-3">{hint}</span>}
    </>
  );
}

/** Every typed word must appear somewhere in the text; cmdk's own filter cannot see the dynamic rows. */
export function matches(text: string, search: string): boolean {
  const hay = text.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowShortcuts: () => void;
}

/**
 * Ctrl+K palette: pages the role can see, a jump to an address or an alert / incident / flow by id,
 * and a few actions. It only navigates (or switches theme); every change still goes through the pages.
 */
export function CommandPalette({ open, onOpenChange, onShowShortcuts }: CommandPaletteProps) {
  const { can, activeOrg } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toggleTheme = useToggleTheme();
  const [search, setSearch] = useState("");
  const q = classifyQuery(search);
  const org = activeOrg?.id ?? "none";

  const go = (to: string) => {
    onOpenChange(false);
    setSearch("");
    navigate(to);
  };
  const close = (fn: () => void) => () => {
    onOpenChange(false);
    setSearch("");
    fn();
  };

  const id = q.kind === "id" ? q.value : "";
  const incident = useExists<Incident>(`/incidents/${id}`, open && q.kind === "id");
  const alert = useExists<Alert>(`/alerts/${id}`, open && q.kind === "id");
  const flow = useExists<Flow>(`/flows/${id}`, open && q.kind === "id");
  const idLookups = [incident, alert, flow];
  const idSearching = q.kind === "id" && idLookups.some((l) => l.isLoading);

  const prefix = q.kind === "partial-ip" || q.kind === "ip" ? q.value : "";
  const assets = useQuery({
    queryKey: [org, "palette", "assets", prefix],
    queryFn: () => api<Page<Asset>>("/assets", { query: { q: prefix, limit: 6, includeInactive: "true" } }),
    enabled: open && prefix.length >= 3,
    staleTime: 30_000,
  });

  const incidents = useQuery({ queryKey: [org, "incidents"], queryFn: () => api<{ items: Incident[] }>("/incidents"), enabled: open && q.kind === "text" });

  const pages = NAV.flatMap((g) => g.items).filter((p) => (!p.requires || can(p.requires)) && (q.kind === "empty" || matches(`go to ${p.label} ${t("palette.goTo", { page: t(`nav.pages.${p.key}`) })}`, search)));
  const actions = [
    { key: "theme", label: t("palette.toggleTheme"), icon: <SunMoon className="h-4 w-4" />, run: close(toggleTheme), hint: undefined },
    { key: "help", label: t("palette.shortcuts"), icon: <Keyboard className="h-4 w-4" />, run: close(onShowShortcuts), hint: "?" },
  ].filter((a) => q.kind === "empty" || matches(a.label, search));
  const incidentHits = (q.kind === "text" ? (incidents.data?.items ?? []) : []).filter((i) => matches(`${i.title} ${i.id} ${i.sourceIp ?? ""}`, search)).slice(0, 8);
  const assetHits = (assets.data?.items ?? []).filter((a) => !(q.kind === "ip" && a.ip === q.value));
  const nothingElse = q.kind === "id" && !idSearching && idLookups.every((l) => l.isError);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setSearch("");
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[color:var(--scrim)] data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          aria-describedby="palette-help"
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-surface-2 shadow-e3 data-[state=open]:animate-page-in"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description id="palette-help" className="sr-only">
            Type to find a page, an address, or an alert, incident or flow by its id. Use the arrow keys and Enter.
          </DialogPrimitive.Description>
          <Command label={t("palette.label")} loop shouldFilter={false}>
            <div className="flex items-center gap-2 border-b border-subtle px-3">
              <Search aria-hidden className="h-4 w-4 shrink-0 text-fg-3" />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder={t("palette.placeholder")}
                className="h-12 w-full bg-transparent text-body text-fg-1 outline-none placeholder:text-fg-3"
              />
            </div>
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-small text-fg-3">
                {idSearching ? "" : nothingElse ? t("palette.noId") : t("palette.noMatch")}
              </Command.Empty>
              {idSearching && (
                <p role="status" className="px-3 py-2 text-small text-fg-3">
                  Looking that id up…
                </p>
              )}

              {q.kind === "ip" && (
                <Command.Group heading={t("palette.address")} className={group}>
                  <Command.Item value={`open asset ${q.value}`} onSelect={() => go(`/assets/${encodeURIComponent(q.value)}`)} className={item}>
                    <Row icon={<Server className="h-4 w-4" />} hint={t("palette.asset")}>
                      Open asset <span className="font-mono text-fg-1">{q.value}</span>
                    </Row>
                  </Command.Item>
                  <Command.Item value={`flows from ${q.value}`} onSelect={() => go(`/flows?sourceIp=${encodeURIComponent(q.value)}`)} className={item}>
                    <Row icon={<ListTree className="h-4 w-4" />} hint={t("palette.flows")}>
                      Flows from <span className="font-mono text-fg-1">{q.value}</span>
                    </Row>
                  </Command.Item>
                </Command.Group>
              )}
              {assetHits.length > 0 && (
                <Command.Group heading={t("palette.assets")} className={group}>
                  {assetHits.map((a) => (
                    <Command.Item key={a.ip} value={`asset ${a.ip}`} onSelect={() => go(`/assets/${encodeURIComponent(a.ip)}`)} className={item}>
                      <Row icon={<Server className="h-4 w-4" />} hint={a.scope}>
                        <span className="font-mono text-fg-1">{a.ip}</span>
                      </Row>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {q.kind === "id" && (incident.isSuccess || alert.isSuccess || flow.isSuccess) && (
                <Command.Group heading={t("palette.matchesId")} className={group}>
                  {incident.isSuccess && (
                    <Command.Item value={`incident ${id}`} onSelect={() => go(`/incidents/${id}`)} className={item}>
                      <Row icon={<ShieldAlert className="h-4 w-4" />} hint={t("palette.incident")}>
                        {incident.data.title}
                      </Row>
                    </Command.Item>
                  )}
                  {alert.isSuccess && (
                    <Command.Item value={`alert ${id}`} onSelect={() => go(`/alerts?alert=${id}&status=all`)} className={item}>
                      <Row icon={<Bell className="h-4 w-4" />} hint={t("palette.alert")}>
                        {alert.data.type} alert from {alert.data.srcIp ?? "several sources"}
                      </Row>
                    </Command.Item>
                  )}
                  {flow.isSuccess && (
                    <Command.Item value={`flow ${id}`} onSelect={() => go(`/flows?flow=${id}`)} className={item}>
                      <Row icon={<ListTree className="h-4 w-4" />} hint={t("palette.flow")}>
                        {flow.data.sourceIp} → {flow.data.destinationIp}:{flow.data.destinationPort}
                      </Row>
                    </Command.Item>
                  )}
                </Command.Group>
              )}
              {incidentHits.length > 0 && (
                <Command.Group heading={t("palette.incidents")} className={group}>
                  {incidentHits.map((i) => (
                    <Command.Item key={i.id} value={`incident ${i.id}`} onSelect={() => go(`/incidents/${i.id}`)} className={item}>
                      <Row icon={<ShieldAlert className="h-4 w-4" />} hint={`${i.severity} · ${i.status}`}>
                        {i.title}
                      </Row>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {pages.length > 0 && (
                <Command.Group heading={t("palette.pages")} className={group}>
                  {pages.map((p) => (
                    <Command.Item key={p.to} value={`go to ${p.label}`} onSelect={() => go(p.to)} className={item}>
                      <Row icon={<p.icon className="h-4 w-4" />} hint={p.go ? t("palette.gThen", { key: p.go.toUpperCase() }) : undefined}>
                        {t(`nav.pages.${p.key}`)}
                      </Row>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {actions.length > 0 && (
                <Command.Group heading={t("palette.actions")} className={group}>
                  {actions.map((a) => (
                    <Command.Item key={a.key} value={a.label} onSelect={a.run} className={item}>
                      <Row icon={a.icon} hint={a.hint}>
                        {a.label}
                      </Row>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
            <p className="flex items-center justify-between border-t border-subtle px-3 py-2 text-caption text-fg-3">
              <span>Up and down to move</span>
              <span className="flex items-center gap-1">
                <CornerDownLeft aria-hidden className="h-3.5 w-3.5" /> to open · Esc to close
              </span>
            </p>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
