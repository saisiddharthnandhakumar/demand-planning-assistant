import { buildPurchaseOrders, type DecisionLine, type PlannedPo, type SkippedLine, type VendorMapRow } from "./build";
import { ZohoError, type CreatedPurchaseOrder, type ZohoClient, type ZohoConfig, type ZohoRuntime } from "@/lib/zoho";

// Creates the draft purchase orders for a submitted run: one per vendor,
// idempotent, and blocked while the system is paused. Everything outside the
// decisions is injected, so every rule below is tested without a database or Zoho.

export type PoStatus = "pending" | "dry_run" | "created" | "failed";

export interface PoRow {
  vendor: string;
  status: PoStatus;
  zohoPoId: string | null;
  error: string | null;
}

export interface PoUpdate {
  status: PoStatus;
  zohoPoId?: string | null;
  zohoPoUrl?: string | null;
  response?: unknown;
  error?: string | null;
  warning?: string | null;
}

export interface PoDeps {
  getRun(runId: string): Promise<{ status: string; submittedBy: string | null } | null>;
  getSystemState(): Promise<{ paused: boolean; reason: string | null }>;
  loadDecisions(runId: string): Promise<DecisionLine[]>;
  loadVendorMap(): Promise<VendorMapRow[]>;
  listPos(runId: string): Promise<PoRow[]>;
  /**
   * Atomically takes the (run, vendor) slot. `from` is the status being
   * replaced: null for a brand-new slot, or the previous status when retrying.
   * Returns false if someone else got there first (so no second call is made).
   */
  claim(runId: string, po: PlannedPo, status: "pending" | "dry_run", from: PoStatus | null): Promise<boolean>;
  finish(runId: string, vendorId: string, update: PoUpdate): Promise<void>;
  audit(action: string, detail: Record<string, unknown>): Promise<void>;
  runtime: ZohoRuntime;
  createClient(config: ZohoConfig): ZohoClient;
  /** Configured purchase rate, if any. Never invented. */
  purchaseRate?: number;
  today(): string;
}

export type PoOutcome = {
  vendorId: string;
  vendorName: string;
  result: "created" | "dry_run" | "failed" | "unknown" | "already" | "in_progress";
  message?: string;
  poId?: string;
};

export type CreatePosResult =
  | { ok: true; mode: "dry-run" | "live"; outcomes: PoOutcome[]; skipped: SkippedLine[] }
  | { ok: false; kind: "not_found" | "not_submitted" | "blocked" | "config"; error: string };

const UNKNOWN_NOTE = "The request was sent but Zoho's answer was not clear, so the order may exist in Zoho. Search Zoho for a purchase order with this run id as its reference before retrying.";

export async function createPurchaseOrders(deps: PoDeps, runId: string): Promise<CreatePosResult> {
  const run = await deps.getRun(runId);
  if (!run) return { ok: false, kind: "not_found", error: "Run not found." };
  if (run.status !== "submitted") return { ok: false, kind: "not_submitted", error: "Purchase orders are only created for a submitted run." };

  // Blocked entirely while paused: nothing is written and nothing is sent.
  const state = await deps.getSystemState();
  if (state.paused) {
    return { ok: false, kind: "blocked", error: `The system is paused${state.reason ? ` (${state.reason.replace(/\.$/, "")})` : ""}, so purchase orders are blocked. Resume it, then create them from this run.` };
  }

  const rt = deps.runtime;
  if (rt.mode === "live" && !rt.ok) {
    return { ok: false, kind: "config", error: `Live mode is on but Zoho is not fully configured. Missing: ${rt.missing.join(", ")}.` };
  }

  const [lines, vendorMap, existing] = await Promise.all([deps.loadDecisions(runId), deps.loadVendorMap(), deps.listPos(runId)]);
  const { orders, skipped } = buildPurchaseOrders({
    runId,
    lines,
    vendorMap,
    date: deps.today(),
    approvedBy: run.submittedBy ?? "the planner",
    purchaseRate: deps.purchaseRate,
  });
  const byVendor = new Map(existing.map((p) => [p.vendor, p]));
  const live = rt.mode === "live" && rt.ok ? rt : null;
  const client = live ? deps.createClient(live.config) : null;
  const outcomes: PoOutcome[] = [];

  for (const po of orders) {
    const base = { vendorId: po.vendorId, vendorName: po.vendorName };
    const row = byVendor.get(po.vendorId);

    // Idempotency: never create a second order for the same run and vendor.
    if (row?.status === "created") {
      outcomes.push({ ...base, result: "already", poId: row.zohoPoId ?? undefined });
      continue;
    }
    if (row?.status === "pending") {
      outcomes.push({ ...base, result: "in_progress", message: row.error ?? "A request for this order is already in progress." });
      continue;
    }
    if (row?.status === "dry_run" && !live) {
      outcomes.push({ ...base, result: "already" });
      continue;
    }

    // --- dry-run: store the payload, call nothing
    if (!live) {
      if (!(await deps.claim(runId, po, "dry_run", row?.status ?? null))) {
        outcomes.push({ ...base, result: "already" });
        continue;
      }
      await deps.audit("po.dry_run", { runId, vendor: po.vendorId, lines: po.lines.length, units: po.totalUnits });
      outcomes.push({ ...base, result: "dry_run" });
      continue;
    }

    // --- live
    if (!(await deps.claim(runId, po, "pending", row?.status ?? null))) {
      outcomes.push({ ...base, result: "in_progress", message: "Another request is creating this order." });
      continue;
    }
    if (po.hasPlaceholderIds) {
      const error = "This order still uses PLACEHOLDER Zoho ids from the sample vendor map. Put the real Zoho vendor and item ids in the map first. Nothing was sent to Zoho.";
      await deps.finish(runId, po.vendorId, { status: "failed", error });
      await deps.audit("po.failed", { runId, vendor: po.vendorId, error });
      outcomes.push({ ...base, result: "failed", message: error });
      continue;
    }

    try {
      const made: CreatedPurchaseOrder = await client!.createDraftPurchaseOrder(po.payload);
      await deps.finish(runId, po.vendorId, { status: "created", zohoPoId: made.poId, zohoPoUrl: made.url, response: made.raw, warning: made.statusWarning ?? null, error: null });
      await deps.audit("po.created", { runId, vendor: po.vendorId, zohoPoId: made.poId, poNumber: made.poNumber, lines: po.lines.length, units: po.totalUnits });
      outcomes.push({ ...base, result: "created", poId: made.poId, message: made.statusWarning });
    } catch (err) {
      const e = err instanceof ZohoError ? err : new ZohoError(err instanceof Error ? err.message : String(err), "unknown");
      if (e.kind === "unknown") {
        // The order may exist. Leave the slot taken so nothing can create a duplicate.
        const error = `${e.message} ${UNKNOWN_NOTE}`;
        await deps.finish(runId, po.vendorId, { status: "pending", error });
        await deps.audit("po.unknown", { runId, vendor: po.vendorId, error });
        outcomes.push({ ...base, result: "unknown", message: error });
      } else {
        await deps.finish(runId, po.vendorId, { status: "failed", error: e.message });
        await deps.audit("po.failed", { runId, vendor: po.vendorId, kind: e.kind, zohoCode: e.zohoCode ?? null, error: e.message });
        outcomes.push({ ...base, result: "failed", message: e.message });
      }
    }
  }

  return { ok: true, mode: live ? "live" : "dry-run", outcomes, skipped };
}
