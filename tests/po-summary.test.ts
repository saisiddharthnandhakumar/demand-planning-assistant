import { describe, expect, it } from "vitest";
import type { CreatePosResult, PoOutcome } from "@/lib/po/create";
import { summarizePoResult } from "@/lib/po/summary";

const o = (result: PoOutcome["result"]): PoOutcome => ({ vendorId: "V", vendorName: "V", result });
const ok = (outcomes: PoOutcome[], skipped: CreatePosResult extends infer R ? (R extends { skipped: infer S } ? S : never) : never = []): CreatePosResult => ({ ok: true, mode: "live", outcomes, skipped });

describe("summarizePoResult", () => {
  it("says what was created", () => {
    expect(summarizePoResult(ok([o("created"), o("created"), o("created")]))).toEqual({ ok: true, message: "3 draft orders created in Zoho." });
    expect(summarizePoResult(ok([o("created")])).message).toBe("1 draft order created in Zoho.");
  });

  it("says previews were not sent to Zoho", () => {
    expect(summarizePoResult(ok([o("dry_run"), o("dry_run")]))).toEqual({ ok: true, message: "2 orders prepared as a preview (nothing was sent to Zoho)." });
  });

  it("a repeat is reported as already existing, and is not a problem", () => {
    expect(summarizePoResult(ok([o("already"), o("already")]))).toEqual({ ok: true, message: "2 orders already existed and was left alone." });
  });

  it("any failure, unclear answer or skipped line makes the result not ok, and says so", () => {
    expect(summarizePoResult(ok([o("created"), o("failed")]))).toEqual({ ok: false, message: "1 draft order created in Zoho; 1 order failed." });
    expect(summarizePoResult(ok([o("unknown")])).message).toMatch(/unclear answer from Zoho: check Zoho before retrying/);
    expect(summarizePoResult(ok([o("created")], [{ skuId: "S", quantity: 5, reason: "x" }]))).toMatchObject({ ok: false, message: expect.stringContaining("1 line skipped for want of a vendor mapping") });
  });

  it("nothing to order", () => {
    expect(summarizePoResult(ok([]))).toEqual({ ok: true, message: "Nothing to order in this run." });
  });

  it("a refusal is passed through as the reason", () => {
    expect(summarizePoResult({ ok: false, kind: "blocked", error: "The system is paused, so purchase orders are blocked." })).toEqual({ ok: false, message: "The system is paused, so purchase orders are blocked." });
  });
});
