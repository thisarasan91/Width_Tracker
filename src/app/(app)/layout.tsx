import Link from "next/link";
import { Activity, Cpu, Database, Gauge, LogOut, ScrollText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { signOutAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard">
          <span className="brand-mark">TB</span>
          <span>TB Meter</span>
        </Link>

        <nav className="nav-list" aria-label="Primary">
          <Link className="nav-link" href="/dashboard">
            <Gauge aria-hidden="true" className="icon" />
            Dashboard
          </Link>
          <Link className="nav-link" href="/devices">
            <Cpu aria-hidden="true" className="icon" />
            Devices
          </Link>
          <Link className="nav-link" href="/programs">
            <ScrollText aria-hidden="true" className="icon" />
            Programs
          </Link>
          <Link className="nav-link" href="/measurements">
            <Database aria-hidden="true" className="icon" />
            Measurements
          </Link>
        </nav>

        <div className="sidebar-footer">
          <span>{user.email}</span>
          <form action={signOutAction}>
            <button className="button secondary full-width" type="submit">
              <LogOut aria-hidden="true" className="icon" />
              Sign out
            </button>
          </form>
          <span>
            <Activity aria-hidden="true" className="icon" /> Cloud verification enabled
          </span>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
