import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { ParticleBackground } from "@/components/background/ParticleBackground";

export function DashboardLayout() {
  return (
    <div className="flex min-h-screen bg-base-950">
      <ParticleBackground />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />
        <main className="flex-1 p-3 sm:p-4 md:p-6 max-w-[1600px] w-full mx-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
