import * as Menu from "@radix-ui/react-dropdown-menu";
import { Building2, ChevronsUpDown, LogOut, MoreHorizontal, Search, Settings, ShieldCheck, SunMoon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { ShortcutsProvider, useShortcuts } from "@/features/shortcuts/ShortcutsProvider";
import { useToggleTheme } from "@/features/shortcuts/useToggleTheme";
import { cn } from "@/lib/format";
import { NAV, type NavItem } from "./nav";

const MOBILE = ["/", "/alerts", "/incidents", "/flows"];

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "relative flex h-9 items-center gap-3 rounded-md px-3 text-body transition-colors duration-fast",
    isActive ? "bg-accent-soft font-medium text-fg-1 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent" : "text-fg-2 hover:bg-surface-3 hover:text-fg-1",
  );
}

/** Opens the command palette; Ctrl+K does the same from anywhere. */
function SearchButton() {
  const { openPalette } = useShortcuts();
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-keyshortcuts="Control+K Meta+K"
      className="flex h-9 items-center gap-2 rounded-md border bg-surface-1 px-3 text-small text-fg-2 hover:border-strong hover:text-fg-1"
    >
      <Search aria-hidden className="h-4 w-4" />
      <span className="hidden sm:inline">{t("shell.search")}</span>
      <kbd className="hidden rounded-sm border bg-surface-2 px-1.5 font-mono text-caption text-fg-3 md:inline">Ctrl K</kbd>
    </button>
  );
}

function OrgSwitcher() {
  const { orgs, activeOrg, switchOrg } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  if (!activeOrg) return null;
  return (
    <Menu.Root>
      <Menu.Trigger className="flex h-9 max-w-[240px] items-center gap-2 rounded-md border bg-surface-1 px-3 text-small text-fg-1 hover:border-strong">
        <Building2 aria-hidden className="h-4 w-4 text-fg-3" />
        {/* The accessible name must contain the visible text (WCAG 2.5.3), so the purpose is added, not substituted. */}
        <span className="sr-only">{t("shell.switchOrg")}</span>
        <span className="truncate">{activeOrg.name}</span>
        <span className="rounded-sm bg-surface-3 px-1.5 text-caption text-fg-2">{activeOrg.role}</span>
        <ChevronsUpDown aria-hidden className="h-3.5 w-3.5 text-fg-3" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className="z-50 min-w-[240px] rounded-md border bg-surface-2 p-1 shadow-e2">
          <Menu.Label className="px-2 py-1.5 text-caption uppercase tracking-[0.04em] text-fg-3">{t("shell.organisations")}</Menu.Label>
          {orgs.map((o) => (
            <Menu.Item
              key={o.id}
              onSelect={() => {
                void switchOrg(o.id);
                navigate("/");
              }}
              className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-small outline-none data-[highlighted]:bg-surface-3", o.id === activeOrg.id ? "text-fg-1" : "text-fg-2")}
            >
              <span className="truncate">{o.name}</span>
              <span className="text-caption text-fg-3">{o.role}</span>
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toggleTheme = useToggleTheme();
  const { t } = useTranslation();
  if (!user) return null;
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <Menu.Root>
      <Menu.Trigger className="flex h-9 w-9 items-center justify-center rounded-full border bg-surface-2 text-caption font-semibold text-fg-1 hover:border-strong" aria-label={t("shell.accountMenu")}>
        {initials || "?"}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className="z-50 min-w-[220px] rounded-md border bg-surface-2 p-1 shadow-e2">
          <div className="px-2 py-1.5">
            <p className="truncate text-small font-medium text-fg-1">{user.name}</p>
            <p className="truncate text-caption text-fg-3">{user.email}</p>
          </div>
          <Menu.Separator className="my-1 h-px bg-surface-3" />
          <Menu.Item onSelect={toggleTheme} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-small text-fg-2 outline-none data-[highlighted]:bg-surface-3 data-[highlighted]:text-fg-1">
            <SunMoon aria-hidden className="h-4 w-4" /> {t("shell.toggleTheme")}
          </Menu.Item>
          <Menu.Item onSelect={() => navigate("/settings")} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-small text-fg-2 outline-none data-[highlighted]:bg-surface-3 data-[highlighted]:text-fg-1">
            <Settings aria-hidden className="h-4 w-4" /> {t("shell.settings")}
          </Menu.Item>
          <Menu.Item onSelect={() => void logout()} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-small text-fg-2 outline-none data-[highlighted]:bg-surface-3 data-[highlighted]:text-fg-1">
            <LogOut aria-hidden className="h-4 w-4" /> {t("shell.signOut")}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Mobile bottom bar keeps four destinations; every other page stays reachable from "More". */
function MobileMore({ items }: { items: NavItem[] }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const active = items.some((i) => pathname.startsWith(i.to));
  return (
    <Menu.Root>
      <Menu.Trigger className={cn("flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-caption outline-none", active ? "text-accent-fg" : "text-fg-3")} aria-label={t("shell.morePages")}>
        <MoreHorizontal aria-hidden className="h-5 w-5" strokeWidth={1.75} />
        <span>{t("shell.more")}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content side="top" align="end" sideOffset={6} className="z-50 max-h-[70vh] min-w-[220px] overflow-y-auto rounded-md border bg-surface-2 p-1 shadow-e2">
          {items.map((i) => (
            <Menu.Item key={i.to} onSelect={() => navigate(i.to)} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-sm px-2 text-small text-fg-2 outline-none data-[highlighted]:bg-surface-3 data-[highlighted]:text-fg-1">
              <i.icon aria-hidden className="h-4 w-4" /> {t(`nav.pages.${i.key}`)}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Shell() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const visible = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.requires || can(i.requires)) })).filter((g) => g.items.length);
  const mobileItems = visible.flatMap((g) => g.items).filter((i) => MOBILE.includes(i.to));
  const moreItems = visible.flatMap((g) => g.items).filter((i) => !MOBILE.includes(i.to));
  return (
    <div className="flex h-full bg-bg-1">
      <a href="#main" className="sr-only z-50 rounded-md bg-surface-2 px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        {t("shell.skip")}
      </a>
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-subtle bg-bg-0 md:flex">
        <div className="flex h-14 items-center gap-2 px-5">
          <ShieldCheck aria-hidden className="h-5 w-5 text-accent-fg" strokeWidth={1.75} />
          <span className="text-h3 font-semibold tracking-[-0.01em] text-fg-1">Sentinel</span>
        </div>
        <nav aria-label={t("shell.mainNav")} className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
          {visible.map((g) => (
            <div key={g.group}>
              <p className="px-3 pb-1.5 text-caption font-medium uppercase tracking-[0.04em] text-fg-3">{t(`nav.groups.${g.group}`)}</p>
              <ul className="space-y-0.5">
                {g.items.map((i) => (
                  <li key={i.to}>
                    <NavLink to={i.to} end={i.to === "/"} className={navClass}>
                      <i.icon aria-hidden className="h-5 w-5" strokeWidth={1.75} />
                      {t(`nav.pages.${i.key}`)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <p className="px-5 py-4 text-caption text-fg-3">{t("shell.scope")}</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-subtle bg-bg-1 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck aria-hidden className="h-5 w-5 text-accent-fg md:hidden" strokeWidth={1.75} />
            <OrgSwitcher />
          </div>
          <div className="flex items-center gap-2">
            <SearchButton />
            <UserMenu />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {/* Keyed by route so each page enters with a short fade; query-string changes do not re-animate. */}
          <div key={pathname} className="mx-auto max-w-content animate-page-in px-4 py-6 md:px-6 md:py-8">
            <Outlet />
          </div>
        </main>
        <nav aria-label={t("shell.mainNavMobile")} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-subtle bg-bg-0 md:hidden">
          {mobileItems.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === "/"}
              className={({ isActive }) => cn("flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-caption", isActive ? "text-accent-fg" : "text-fg-3")}
            >
              <i.icon aria-hidden className="h-5 w-5" strokeWidth={1.75} />
              <span className="truncate">{t(`nav.pages.${i.key === "overview" ? "overviewShort" : i.key}`)}</span>
            </NavLink>
          ))}
          <MobileMore items={moreItems} />
        </nav>
      </div>
    </div>
  );
}

export function AppShell() {
  return (
    <ShortcutsProvider>
      <Shell />
    </ShortcutsProvider>
  );
}
