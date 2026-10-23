import { and, eq, gte } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb, type Db } from "@/lib/db";
import { getSystemState, loadEngineInput } from "@/lib/db/queries";
import { auditLog, runItems, runs } from "@/lib/db/schema";
import { startRun, type RunDeps, type RunTrigger, type StartRunResult } from "./start";

export function dbRunDeps(db: Db): RunDeps {
  return {
    getSystemState: () => getSystemState(db),

    async loadInput(asOfDate) {
      const { input, rulesVersion } = await loadEngineInput(db, { asOfDate });
      return { input, rulesVersion };
    },

    async findRecentOpenRun({ trigger, asOfDate, since }) {
      const [row] = await db
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(
            eq(runs.trigger, trigger),
            eq(runs.status, "open"),
            eq(runs.asOfDate, asOfDate),
            gte(runs.startedAt, since),
          ),
        )
        .limit(1);
      return row?.id ?? null;
    },

    async saveOpenRun(run) {
      // One batch = one transaction: the run, all its items and the audit row, or nothing.
      const statements: BatchItem<"pg">[] = [
        db.insert(runs).values({
          id: run.id,
          trigger: run.trigger,
          asOfDate: run.asOfDate,
          status: "open",
          rulesVersion: run.rulesVersion,
          rulesSnapshot: run.rulesSnapshot,
        }),
        db.insert(runItems).values(run.items),
        db.insert(auditLog).values({
          actor: run.trigger,
          action: "run.start",
          detail: { runId: run.id, asOfDate: run.asOfDate, rulesVersion: run.rulesVersion, items: run.items.length },
        }),
      ];
      await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
    },

    async saveNonRun(run) {
      const statements: BatchItem<"pg">[] = [
        db.insert(runs).values({
          id: run.id,
          trigger: run.trigger,
          asOfDate: run.asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(run.asOfDate) ? run.asOfDate : null,
          status: run.status,
          skipReason: run.skipReason,
          error: run.error,
        }),
        db.insert(auditLog).values({
          actor: run.trigger,
          action: `run.${run.status}`,
          detail: { runId: run.id, reason: run.skipReason ?? run.error },
        }),
      ];
      await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
    },

    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  };
}

export function startRunWithDb(args: { trigger: RunTrigger; asOfDate?: string }): Promise<StartRunResult> {
  return startRun(dbRunDeps(getDb()), args);
}
