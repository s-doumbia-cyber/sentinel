import { lazy, Suspense, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, Skeleton } from "@/components/ui/States";
import { useAuth } from "@/features/auth/AuthContext";
import { LoginPage, RegisterPage } from "@/features/auth/AuthPages";

// Route-level code splitting (§11): charts and heavy pages load on demand.
const CommandCenter = lazy(() => import("@/features/overview/CommandCenter").then((m) => ({ default: m.CommandCenter })));
const FlowsPage = lazy(() => import("@/features/flows/FlowsPage").then((m) => ({ default: m.FlowsPage })));
const DatasetsPage = lazy(() => import("@/features/datasets/DatasetsPage").then((m) => ({ default: m.DatasetsPage })));
const ModelsPage = lazy(() => import("@/features/models/ModelsPage").then((m) => ({ default: m.ModelsPage })));
const IncidentsPage = lazy(() => import("@/features/incidents/IncidentsPage").then((m) => ({ default: m.IncidentsPage })));
const TeamPage = lazy(() => import("@/features/team/TeamAndAudit").then((m) => ({ default: m.TeamPage })));
const AuditPage = lazy(() => import("@/features/team/TeamAndAudit").then((m) => ({ default: m.AuditPage })));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));

function PageFallback() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-32" />
      <Skeleton className="h-64" />
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center" role="status" aria-label="Restoring your session">
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function RequireRole({ action, children }: { action: Parameters<ReturnType<typeof useAuth>["can"]>[0]; children: ReactNode }) {
  const { can } = useAuth();
  // Cosmetic guard; the API answers 403 regardless.
  return can(action) ? <>{children}</> : <EmptyState title="You don’t have access to this page" description="Ask an Owner or Admin of this organisation." />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        {[
          { path: "/", el: <CommandCenter /> },
          { path: "/flows", el: <FlowsPage /> },
          { path: "/datasets", el: <DatasetsPage /> },
          { path: "/models", el: <ModelsPage /> },
          { path: "/incidents", el: <IncidentsPage /> },
          { path: "/team", el: <TeamPage /> },
          {
            path: "/audit",
            el: (
              <RequireRole action="audit:read">
                <AuditPage />
              </RequireRole>
            ),
          },
          { path: "/settings", el: <SettingsPage /> },
        ].map((r) => (
          <Route key={r.path} path={r.path} element={<Suspense fallback={<PageFallback />}>{r.el}</Suspense>} />
        ))}
        <Route
          path="*"
          element={
            <EmptyState
              title="Page not found"
              description="This page does not exist in Sentinel."
              action={
                <Link to="/" className="text-accent-fg hover:underline">
                  Back to the Command Center
                </Link>
              }
            />
          }
        />
      </Route>
    </Routes>
  );
}
