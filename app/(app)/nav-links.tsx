"use client";

import { ClipboardCheck, CalendarDays, LayoutDashboard, LogOut, Menu, Settings, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

const GROUPS = [
  { label: "Overview", links: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Work",
    links: [
      { href: "/runs", label: "Runs", icon: ClipboardCheck },
      { href: "/events", label: "Events", icon: CalendarDays },
    ],
  },
  {
    label: "Setup",
    links: [
      { href: "/rules", label: "Rules", icon: SlidersHorizontal },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

/** A small mark drawn from the product's own idea: demand bars with the reorder line across them. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="3" y="12" width="4" height="9" rx="1" fill="currentColor" opacity="0.35" />
      <rect x="10" y="7" width="4" height="14" rx="1" fill="currentColor" opacity="0.65" />
      <rect x="17" y="3" width="4" height="18" rx="1" fill="currentColor" />
      <rect x="1" y="10.5" width="22" height="1.5" rx="0.75" fill="var(--signal)" />
    </svg>
  );
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {GROUPS.map((g) => (
        <div key={g.label} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-xs text-muted-foreground">{g.label}</p>
          {g.links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
            const Icon = l.icon;
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-md px-3 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" strokeWidth={1.6} aria-hidden="true" />
                {l.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Planner({ signOut }: { signOut: () => Promise<void> }) {
  return (
    <div className="flex items-center gap-3 rounded-md px-3 py-2">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--pill-info-bg)] text-xs font-medium text-[var(--pill-info-ink)]"
        aria-hidden="true"
      >
        RK
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-medium">Raghav Kulkarni</p>
        <p className="truncate text-xs text-muted-foreground">Planner</p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <LogOut className="size-4" strokeWidth={1.6} />
        </button>
      </form>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-3">
      <Mark className="size-7 text-foreground" />
      <div className="leading-tight">
        <p className="text-sm font-medium tracking-tight">Demand planning</p>
        <p className="text-xs text-muted-foreground">Maharashtra and Goa</p>
      </div>
    </div>
  );
}

export function AppSidebar({ signOut }: { signOut: () => Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Close the sheet when the route changes (adjusting state during render, not in an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <>
      {/* Desktop: labelled sidebar on the page ground. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between gap-8 py-6 pr-2 pl-3 md:flex lg:w-64">
        <div className="flex flex-col gap-8">
          <Brand />
          <NavList pathname={pathname} />
        </div>
        <Planner signOut={signOut} />
      </aside>

      {/* Phone: a 48px bar and a full-screen sheet. */}
      <div className="sticky top-0 z-30 flex h-12 items-center justify-between bg-background px-4 md:hidden">
        <div className="flex items-center gap-2">
          <Mark className="size-6 text-foreground" />
          <span className="text-sm font-medium tracking-tight">Demand planning</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          className="flex size-9 items-center justify-center rounded-md hover:bg-sidebar-accent"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <div id="mobile-nav" className="fixed inset-x-0 top-12 bottom-0 z-20 flex flex-col justify-between overflow-y-auto bg-background p-4 md:hidden">
          <NavList pathname={pathname} onNavigate={() => setOpen(false)} />
          <Planner signOut={signOut} />
        </div>
      )}
    </>
  );
}
