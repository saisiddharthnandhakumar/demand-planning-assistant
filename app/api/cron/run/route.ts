import { handleCronRequest } from "@/lib/cron";
import { startRunWithDb } from "@/lib/runs/db-deps";

// Called by Vercel Cron (see vercel.json) with `Authorization: Bearer ${CRON_SECRET}`.
// Not behind the password gate: proxy.ts excludes /api/cron and this handler
// authenticates with the secret instead.
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleCronRequest(request, {
    secret: process.env.CRON_SECRET,
    start: () => startRunWithDb({ trigger: "cron" }),
  });
}
