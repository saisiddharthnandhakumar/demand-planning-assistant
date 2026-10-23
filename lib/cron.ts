import { createHash, timingSafeEqual } from "node:crypto";
import type { StartRunResult } from "@/lib/runs/start";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/**
 * True only when CRON_SECRET is set and the request carries exactly
 * `Authorization: Bearer <CRON_SECRET>`. Vercel sends that header on cron
 * invocations when the CRON_SECRET environment variable is set. An unset secret
 * rejects everything. Comparison is constant time.
 */
export function isAuthorizedCron(authorizationHeader: string | null, secret: string | undefined): boolean {
  if (!secret || !authorizationHeader) return false;
  return timingSafeEqual(sha256(authorizationHeader), sha256(`Bearer ${secret}`));
}

/** The cron route, with its dependencies injected so it can be tested directly. */
export async function handleCronRequest(
  request: Request,
  deps: { secret: string | undefined; start: () => Promise<StartRunResult> },
): Promise<Response> {
  if (!isAuthorizedCron(request.headers.get("authorization"), deps.secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await deps.start();
  // A failed run is a server error so it shows up in Vercel's logs and alerts.
  return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
}
