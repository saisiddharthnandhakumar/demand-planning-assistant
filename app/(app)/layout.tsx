import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { getSystemState } from "@/lib/db/queries";
import { logout } from "../(auth)/login/actions";
import { AppSidebar } from "./nav-links";
import { PauseBanner } from "./pause-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await connection(); // the pause state is read on every request, never at build time
  const state = await getSystemState(getDb());

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AppSidebar signOut={logout} />
      <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-3 pb-10 md:py-6 md:pr-6 md:pl-2">
        {state.paused && <PauseBanner reason={state.reason} since={state.since} runIds={state.breachRunIds} />}
        <main className="mx-auto w-full max-w-6xl flex-1">{children}</main>
      </div>
    </div>
  );
}
