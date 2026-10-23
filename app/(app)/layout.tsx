import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { getSystemState } from "@/lib/db/queries";
import { logout } from "../(auth)/login/actions";
import { NavLinks } from "./nav-links";
import { PauseBanner } from "./pause-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection(); // the pause state is read on every request, never at build time
  const state = await getSystemState(getDb());

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold">Demand Planning Assistant</span>
            <NavLinks />
          </div>
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      {state.paused && <PauseBanner reason={state.reason} since={state.since} runIds={state.breachRunIds} />}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
