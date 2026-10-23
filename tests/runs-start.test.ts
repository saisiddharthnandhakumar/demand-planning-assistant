import { describe, expect, it, vi } from "vitest";
import { AsOfDateError } from "@/lib/runs/errors";
import { engineItemToRow } from "@/lib/runs/map";
import { DUPLICATE_WINDOW_MS, startRun, type OpenRun, type RecordedNonRun, type RunDeps } from "@/lib/runs/start";
import { runEngine } from "@/lib/engine";
import { rulesWith, seedEngineInput } from "./helpers/engine-fixtures";

function makeDeps(overrides: Partial<RunDeps> = {}) {
  const saved: { open: OpenRun[]; nonRuns: RecordedNonRun[] } = { open: [], nonRuns: [] };
  let n = 0;
  const deps: RunDeps = {
    getSystemState: vi.fn(async () => ({ paused: false, reason: null, since: null })),
    loadInput: vi.fn(async (asOfDate?: string) => ({
      input: seedEngineInput(asOfDate ? { asOfDate } : {}),
      rulesVersion: 7,
    })),
    findRecentOpenRun: vi.fn(async () => null),
    saveOpenRun: vi.fn(async (run: OpenRun) => void saved.open.push(run)),
    saveNonRun: vi.fn(async (run: RecordedNonRun) => void saved.nonRuns.push(run)),
    now: () => new Date("2026-10-23T04:00:00Z"),
    newId: () => `run-${++n}`,
    ...overrides,
  };
  return { deps, saved };
}

describe("startRun", () => {
  it("computes and stores an open run with one item per SKU", async () => {
    const { deps, saved } = makeDeps();
    const res = await startRun(deps, { trigger: "manual" });
    expect(res).toMatchObject({ status: "started", runId: "run-1", asOfDate: "2026-10-19" });
    expect(saved.open).toHaveLength(1);
    const run = saved.open[0];
    expect(run).toMatchObject({ id: "run-1", trigger: "manual", asOfDate: "2026-10-19", rulesVersion: 7 });
    expect(run.items).toHaveLength(15);
    expect(run.items.every((i) => i.runId === "run-1" && i.decisionStatus === "pending")).toBe(true);
    expect(run.rulesSnapshot.stockout_weeks).toBe(6);
  });

  it("stores exactly what the engine computed (the section 6.2 results)", async () => {
    const { deps, saved } = makeDeps();
    const res = await startRun(deps, { trigger: "cron" });
    if (res.status !== "started") throw new Error("expected started");
    expect(res.summary).toMatchObject({ skus: 15, stockout: 5, overstock: 2, noAction: 8, edge: 1 });
    const bySku = new Map(saved.open[0].items.map((i) => [i.skuId, i]));
    expect(bySku.get("SKU003")).toMatchObject({ recommendedAction: "REORDER_NOW", recommendedQty: 300, isEdge: false });
    expect(bySku.get("SKU006")).toMatchObject({ recommendedAction: "PAUSE_ORDER", recommendedQty: 0 });
    // the only edge SKU keeps the rules' answer as a reference, flagged by is_edge
    const sku001 = bySku.get("SKU001")!;
    expect(sku001).toMatchObject({ isEdge: true, recommendedAction: "REORDER_NOW", recommendedQty: 750 });
    expect(sku001.edgeReasons?.map((r) => r.code)).toEqual(["STEP_CHANGE"]);
    expect(saved.open[0].items.filter((i) => i.isEdge)).toHaveLength(1);
  });

  it("passes a manual as-of override through to the engine", async () => {
    const { deps, saved } = makeDeps();
    await startRun(deps, { trigger: "manual", asOfDate: "2026-10-12" });
    expect(deps.loadInput).toHaveBeenCalledWith("2026-10-12");
    expect(saved.open[0].asOfDate).toBe("2026-10-12");
    expect(saved.open[0].items[0].metrics.lastCompleteWeek).toBe("2026-W41");
  });

  describe("while paused", () => {
    const paused = () =>
      vi.fn(async () => ({ paused: true, reason: "override rate above 30% twice", since: new Date("2026-10-20T00:00:00Z") }));

    it("records a skipped run with the reason and computes nothing", async () => {
      const { deps, saved } = makeDeps({ getSystemState: paused() });
      const res = await startRun(deps, { trigger: "cron" });
      expect(res.status).toBe("skipped");
      expect(res.status === "skipped" && res.reason).toMatch(/paused: override rate above 30% twice/);
      expect(saved.nonRuns).toEqual([
        expect.objectContaining({ trigger: "cron", status: "skipped", skipReason: expect.stringContaining("override rate above 30%") }),
      ]);
      expect(saved.open).toHaveLength(0); // no run, no items
      expect(deps.loadInput).not.toHaveBeenCalled(); // nothing computed, not even loaded
    });

    it("applies to the manual path too (same code path)", async () => {
      const { deps, saved } = makeDeps({ getSystemState: paused() });
      expect((await startRun(deps, { trigger: "manual" })).status).toBe("skipped");
      expect(saved.open).toHaveLength(0);
      expect(deps.loadInput).not.toHaveBeenCalled();
    });

    it("reads the pause flag before anything else", async () => {
      const order: string[] = [];
      const { deps } = makeDeps({
        getSystemState: vi.fn(async () => (order.push("state"), { paused: false, reason: null, since: null })),
        loadInput: vi.fn(async () => (order.push("load"), { input: seedEngineInput(), rulesVersion: 1 })),
      });
      await startRun(deps, { trigger: "cron" });
      expect(order).toEqual(["state", "load"]);
    });
  });

  describe("duplicate protection", () => {
    it("returns the existing run instead of creating a second one", async () => {
      const { deps, saved } = makeDeps({ findRecentOpenRun: vi.fn(async () => "run-existing") });
      const res = await startRun(deps, { trigger: "manual" });
      expect(res).toEqual({ status: "existing", runId: "run-existing" });
      expect(saved.open).toHaveLength(0);
    });

    it("looks back over the duplicate window for the same trigger and resolved as-of date", async () => {
      const { deps } = makeDeps();
      await startRun(deps, { trigger: "cron" });
      expect(deps.findRecentOpenRun).toHaveBeenCalledWith({
        trigger: "cron",
        asOfDate: "2026-10-19",
        since: new Date(new Date("2026-10-23T04:00:00Z").getTime() - DUPLICATE_WINDOW_MS),
      });
    });
  });

  describe("unusable requests", () => {
    it("a bad as-of date is reported to the caller and NOT stored as a run", async () => {
      const { deps, saved } = makeDeps({
        loadInput: vi.fn(async () => {
          throw new AsOfDateError("There is no stock data on or before 2026-01-05.");
        }),
      });
      const res = await startRun(deps, { trigger: "manual", asOfDate: "2026-01-05" });
      expect(res).toEqual({ status: "invalid", error: "There is no stock data on or before 2026-01-05." });
      expect(saved.nonRuns).toHaveLength(0);
      expect(saved.open).toHaveLength(0);
    });
  });

  describe("failures", () => {
    it("records a failed run with the error when loading or computing throws", async () => {
      const { deps, saved } = makeDeps({
        loadInput: vi.fn(async () => {
          throw new Error("No inventory snapshot on or before 2026-01-05.");
        }),
      });
      const res = await startRun(deps, { trigger: "manual", asOfDate: "2026-01-05" });
      expect(res).toMatchObject({ status: "failed", error: "No inventory snapshot on or before 2026-01-05." });
      expect(saved.nonRuns[0]).toMatchObject({ status: "failed", trigger: "manual", asOfDate: "2026-01-05" });
      expect(saved.open).toHaveLength(0);
    });

    it("an engine error (calendar month missing) becomes a failed run, not a crash", async () => {
      const { deps, saved } = makeDeps({
        loadInput: vi.fn(async () => ({ input: seedEngineInput({ calendar: [] }), rulesVersion: 1 })),
      });
      const res = await startRun(deps, { trigger: "cron" });
      expect(res.status).toBe("failed");
      expect(res.status === "failed" && res.error).toMatch(/Calendar has no row/);
      expect(saved.open).toHaveLength(0);
    });

    it("if saving the run fails, the failure is recorded and nothing partial remains", async () => {
      const { deps, saved } = makeDeps({
        saveOpenRun: vi.fn(async () => {
          throw new Error("connection reset");
        }),
      });
      const res = await startRun(deps, { trigger: "cron" });
      expect(res).toMatchObject({ status: "failed", error: "connection reset" });
      expect(saved.nonRuns[0]).toMatchObject({ status: "failed", error: "connection reset" });
    });

    it("if the failure cannot be recorded either, still reports it without throwing", async () => {
      const { deps } = makeDeps({
        loadInput: vi.fn(async () => {
          throw new Error("db down");
        }),
        saveNonRun: vi.fn(async () => {
          throw new Error("db down");
        }),
      });
      await expect(startRun(deps, { trigger: "cron" })).resolves.toEqual({
        status: "failed",
        runId: null,
        error: "db down",
      });
    });
  });
});

describe("engineItemToRow", () => {
  it("copies flags, metrics and reasons, and starts pending with no final decision", () => {
    const result = runEngine(seedEngineInput());
    const item = result.items.find((i) => i.skuId === "SKU004")!;
    const row = engineItemToRow("r1", item);
    expect(row).toMatchObject({
      runId: "r1",
      skuId: "SKU004",
      flags: ["STOCKOUT_RISK"],
      recommendedAction: "REORDER_NOW",
      recommendedQty: 150,
      isEdge: false,
      decisionStatus: "pending",
    });
    expect(row.reason).toBe(item.reason);
    expect(row.finalAction).toBeUndefined();
    expect(row.finalQty).toBeUndefined();
  });

  it("does not alias the engine's arrays", () => {
    const item = runEngine(seedEngineInput()).items[0];
    const row = engineItemToRow("r1", item);
    expect(row.flags).not.toBe(item.flags);
  });

  it("uses the rules passed in, so rule changes change the stored recommendations", () => {
    const item = runEngine(seedEngineInput({ rules: rulesWith({ stockout_weeks: 4 }) })).items.find((i) => i.skuId === "SKU003")!;
    expect(engineItemToRow("r1", item)).toMatchObject({ recommendedAction: "NO_ACTION", recommendedQty: 0 });
  });
});
