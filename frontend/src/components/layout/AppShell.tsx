import { X } from "lucide-react";
import { useState } from "react";
import { Outlet } from "react-router";

import { useServerActivitySync } from "@/hooks/useActivity";
import { useActivityRecorder } from "@/hooks/useActivityRecorder";
import { cn } from "@/lib/format";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  useActivityRecorder();
  useServerActivitySync();

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only z-[70] rounded-lg bg-ember-500 px-4 py-2 text-sm font-medium text-void focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-edge/70 bg-abyss/90 lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-void/70 backdrop-blur-sm transition-opacity lg:hidden",
          menuOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 border-r border-edge bg-abyss transition-transform lg:hidden",
          menuOpen ? "translate-x-0" : "-translate-x-full",
        )}
        aria-hidden={!menuOpen}
        inert={!menuOpen}
      >
        <button
          type="button"
          onClick={() => setMenuOpen(false)}
          className="absolute top-5 right-4 rounded-lg p-2 text-ink-muted hover:bg-panel-raised hover:text-ink"
          aria-label="Close navigation"
        >
          <X className="size-5" />
        </button>
        <Sidebar onNavigate={() => setMenuOpen(false)} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMenu={() => setMenuOpen(true)} />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 outline-none sm:px-6 lg:px-10"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
