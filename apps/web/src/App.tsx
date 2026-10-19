import { Route, Routes } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ProtectedRoute } from "@/router/ProtectedRoute";
import { ThemeEffect } from "@/components/ThemeEffect";

import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import Dashboard from "@/pages/Dashboard";
import Analytics from "@/pages/Analytics";
import ThreatIntelligence from "@/pages/ThreatIntelligence";
import AttackExplorer from "@/pages/AttackExplorer";
import RealTimeMonitor from "@/pages/RealTimeMonitor";
import Incidents from "@/pages/Incidents";
import Reports from "@/pages/Reports";
import Datasets from "@/pages/Datasets";
import MachineLearning from "@/pages/MachineLearning";
import Team from "@/pages/Team";
import Settings from "@/pages/Settings";

export default function App() {
  return (
    <>
      <ThemeEffect />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/threat-intelligence" element={<ThreatIntelligence />} />
          <Route path="/attack-explorer" element={<AttackExplorer />} />
          <Route path="/real-time-monitor" element={<RealTimeMonitor />} />
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/datasets" element={<Datasets />} />
          <Route path="/machine-learning" element={<MachineLearning />} />
          <Route path="/team" element={<Team />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </>
  );
}
