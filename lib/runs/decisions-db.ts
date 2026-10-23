import { and, count, eq, exists, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getSystemState } from "@/lib/db/queries";
import { runItems, runs } from "@/lib/db/schema";
import { buildDecision, decisionInputSchema, type DecisionInput } from "@/lib/decisions";
import { overrideRate, reviewProgress, submitBlocker } from "@/lib/override-rate";

export type DbResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const lockedMessage = (status: string) =>
  status === "submitted" ? "This run has been submitted and is locked." : `This run is ${status} and cannot be edited.`;

/** Rows of the guard that makes a run's items writable only while the run is open. */
const runIsOpen = (db: Db, runId: string) =>
  exists(db.select({ one: sql`1` }).from(runs).where(and(eq(runs.id, runId), eq(runs.status, "open"))));

/**
 * Records one decision (approve, edit, reject, decide, or clear) on one SKU.
 * Validation and the meaning of each decision live in lib/decisions.ts; the
 * write itself is guarded in SQL so a submitted run can never change, even if
 * a request races the submit.
 */
export async function decideItem(db: Db, runId: string, skuId: string, input: DecisionInput): Promise<DbResult> {
  const parsed = decisionInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, error: parsed.error.issues[0].message, fieldErrors };
  }

  const [row] = await db
    .select({
      isEdge: runItems.isEdge,
      recommendedAction: runItems.recommendedAction,
      recommendedQty: runItems.recommendedQty,
      runStatus: runs.status,
    })
    .from(runItems)
    .innerJoin(runs, eq(runs.id, runItems.runId))
    .where(and(eq(runItems.runId, runId), eq(runItems.skuId, skuId)));
  if (!row) return { ok: false, error: "That SKU is not part of this run." };
  if (row.runStatus !== "open") return { ok: false, error: lockedMessage(row.runStatus) };

  const built = buildDecision(parsed.data, row);
  if (!built.ok) return { ok: false, error: built.error };

  const updated = await db
    .update(runItems)
    .set({ ...built.update, decidedAt: built.update.decisionStatus === "pending" ? null : new Date() })
    .where(and(eq(runItems.runId, runId), eq(runItems.skuId, skuId), eq(runItems.isEdge, row.isEdge), runIsOpen(db, runId)))
    .returning({ skuId: runItems.skuId });
  if (updated.length === 0) return { ok: false, error: "This run was submitted while you were deciding, so it is now locked." };
  return { ok: true };
}

/** Number of engine (non-edge) decisions nobody has touched yet. */
export async function countUntouchedEngineItems(db: Db, runId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(runItems)
    .where(and(eq(runItems.runId, runId), eq(runItems.isEdge, false), eq(runItems.decisionStatus, "pending")));
  return r.n;
}

/**
 * Approves every untouched engine decision. The caller passes the count the
 * planner confirmed; if it no longer matches (something changed meanwhile) no
 * approval happens, so he never approves a different set than he agreed to.
 * Edge SKUs are never included.
 */
export async function bulkApproveUntouched(db: Db, runId: string, expectedCount: number): Promise<DbResult<{ approved: number }>> {
  const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
  if (!run) return { ok: false, error: "Run not found." };
  if (run.status !== "open") return { ok: false, error: lockedMessage(run.status) };

  const actual = await countUntouchedEngineItems(db, runId);
  if (actual !== expectedCount) {
    return { ok: false, error: `The number of untouched decisions changed from ${expectedCount} to ${actual}. Nothing was approved. Check and confirm again.` };
  }
  if (actual === 0) return { ok: false, error: "There are no untouched engine decisions to approve." };

  const result = await db.execute(sql`
    with upd as (
      update run_items ri
      set decision_status = 'approved',
          final_action = ri.recommended_action,
          final_qty = ri.recommended_qty,
          override_reason = null,
          override_note = null,
          decided_at = now()
      where ri.run_id = ${runId}
        and not ri.is_edge
        and ri.decision_status = 'pending'
        and exists (select 1 from runs r where r.id = ${runId} and r.status = 'open')
      returning ri.sku_id
    ),
    aud as (
      insert into audit_log (actor, action, detail)
      select 'planner', 'run.bulk_approve',
             jsonb_build_object('runId', ${runId}::text, 'count', (select count(*) from upd))
      where exists (select 1 from upd)
      returning 1
    )
    select count(*)::int as n from upd
  `);
  return { ok: true, approved: Number(result.rows[0]?.n ?? 0) };
}

export type SubmitOutcome = { overrideRate: number | null; skus: number };

/**
 * Submits and locks a run. Refuses unless the system is running and every SKU,
 * engine and edge, has an explicit decision. The override rate is computed
 * here from the decisions read, and the write only commits if those same
 * decisions are still in place (optimistic check), so the stored rate always
 * matches what was submitted.
 */
export async function submitRun(db: Db, args: { runId: string; submittedBy: string }): Promise<DbResult<SubmitOutcome>> {
  const [run] = await db.select().from(runs).where(eq(runs.id, args.runId));
  if (!run) return { ok: false, error: "Run not found." };
  if (run.status !== "open") return { ok: false, error: lockedMessage(run.status) };

  const state = await getSystemState(db);
  if (state.paused) {
    return { ok: false, error: `The system is paused${state.reason ? ` (${state.reason})` : ""}. Resume it before submitting, because submitting creates purchase orders.` };
  }

  const items = await db
    .select({ isEdge: runItems.isEdge, decisionStatus: runItems.decisionStatus, finalAction: runItems.finalAction })
    .from(runItems)
    .where(eq(runItems.runId, args.runId));
  const progress = reviewProgress(items);
  const blocker = submitBlocker(progress);
  if (blocker) return { ok: false, error: blocker };
  if (items.some((i) => i.decisionStatus !== "pending" && !i.finalAction)) {
    return { ok: false, error: "A decision is missing its action. Reopen it and decide again." };
  }

  const rate = overrideRate(items);
  const overridden = progress.engineEdited + progress.engineRejected;
  const result = await db.execute(sql`
    with sub as (
      update runs
      set status = 'submitted', submitted_at = now(), submitted_by = ${args.submittedBy}::text,
          override_rate = ${rate}::numeric
      where id = ${args.runId}
        and status = 'open'
        and (select count(*) from run_items where run_id = ${args.runId} and decision_status = 'pending') = 0
        and (select count(*) from run_items where run_id = ${args.runId} and not is_edge) = ${progress.engineTotal}
        and (select count(*) from run_items where run_id = ${args.runId} and not is_edge
               and decision_status in ('edited', 'rejected')) = ${overridden}
      returning id
    ),
    aud as (
      insert into audit_log (actor, action, detail)
      select ${args.submittedBy}::text, 'run.submit',
             jsonb_build_object('runId', ${args.runId}::text, 'overrideRate', ${rate}::numeric,
                                'engineDecisions', ${progress.engineTotal}::int, 'overridden', ${overridden}::int,
                                'judgmentDecisions', ${progress.edgeTotal}::int)
      from sub
      returning 1
    )
    select (select id from sub) as id
  `);
  if (!result.rows[0]?.id) {
    return { ok: false, error: "The decisions changed while you were submitting, or the run was already submitted. Reload and check them, then submit again." };
  }
  return { ok: true, overrideRate: rate, skus: items.length };
}
