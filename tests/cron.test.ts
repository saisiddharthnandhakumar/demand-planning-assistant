import { describe, expect, it, vi } from "vitest";
import { handleCronRequest, isAuthorizedCron } from "@/lib/cron";
import type { StartRunResult } from "@/lib/runs/start";

const SECRET = "s3cret-value";
const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/cron/run", { headers });

describe("isAuthorizedCron", () => {
  it("accepts exactly 'Bearer <secret>'", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects wrong, partial, differently-cased and malformed headers", () => {
    expect(isAuthorizedCron("Bearer nope", SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false); // missing scheme
    expect(isAuthorizedCron(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET} `, SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCron("Bearer ", SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
    expect(isAuthorizedCron("", SECRET)).toBe(false);
  });

  it("rejects everything when CRON_SECRET is not set", () => {
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron(null, undefined)).toBe(false);
  });
});

describe("handleCronRequest", () => {
  const started: StartRunResult = {
    status: "started",
    runId: "r1",
    asOfDate: "2026-10-19",
    summary: { skus: 15, stockout: 5, overstock: 2, highDemand: 1, noAction: 8, edge: 1 },
  };

  it("returns 401 and starts nothing without the right header", async () => {
    const start = vi.fn(async () => started);
    const bad: Record<string, string>[] = [{}, { authorization: "Bearer wrong" }, { authorization: SECRET }];
    for (const headers of bad) {
      const res = await handleCronRequest(req(headers), { secret: SECRET, start });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
    expect(start).not.toHaveBeenCalled();
  });

  it("returns 401 when the secret is not configured, even for a matching-looking header", async () => {
    const start = vi.fn(async () => started);
    const res = await handleCronRequest(req({ authorization: "Bearer undefined" }), { secret: undefined, start });
    expect(res.status).toBe(401);
    expect(start).not.toHaveBeenCalled();
  });

  it("starts a cron-triggered run with the right header", async () => {
    const start = vi.fn(async () => started);
    const res = await handleCronRequest(req({ authorization: `Bearer ${SECRET}` }), { secret: SECRET, start });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "started", runId: "r1" });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("a paused system is a normal 200 with a skipped result", async () => {
    const start = vi.fn(async (): Promise<StartRunResult> => ({ status: "skipped", runId: "r2", reason: "System is paused" }));
    const res = await handleCronRequest(req({ authorization: `Bearer ${SECRET}` }), { secret: SECRET, start });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "skipped" });
  });

  it("a failed run is a 500 so it shows up in Vercel's logs", async () => {
    const start = vi.fn(async (): Promise<StartRunResult> => ({ status: "failed", runId: "r3", error: "boom" }));
    const res = await handleCronRequest(req({ authorization: `Bearer ${SECRET}` }), { secret: SECRET, start });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ status: "failed", error: "boom" });
  });
});
