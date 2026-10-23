import { desc, eq, lte, max, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import {
  calendar,
  inventory,
  rules,
  rulesHistory,
  runItems,
  runs,
  skus,
  systemState,
  weeklySales,
} from "@/lib/db/schema";
import type { EngineInput } from "@/lib/engine/types";
import { windowWeeks } from "@/lib/engine/metrics";
import { loadActiveEventTags } from "@/lib/db/events";
import { AsOfDateError } from "@/lib/runs/errors";
import { rulesSchema, type Rules } from "@/lib/rules";
import { diffRules, type RulesVersion } from "@/lib/rules-timeline";

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export class RulesError extends Error {}

function parseRulesDocument(document: unknown, where: string): Rules {
  const parsed = rulesSchema.safeParse(document);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new RulesError(`Stored rules (${where}) are invalid: ${detail}`);
  }
  return parsed.data;
}

/** The current rules, validated. Throws a readable error if missing or invalid. */
export async function getRules(db: Db): Promise<RulesVersion> {
  const [row] = await db.select().from(rules).where(eq(rules.id, 1));
  if (!row) throw new RulesError("No rules found in the database. Run `npm run seed` to load the initial rules.");
  return {
    version: row.version,
    document: parseRulesDocument(row.document, `version ${row.version}`),
    by: row.updatedBy,
    at: row.updatedAt,
  };
}

/** Current rules plus every earlier version. */
export async function getRulesVersions(db: Db): Promise<{ current: RulesVersion; all: RulesVersion[] }> {
  const current = await getRules(db);
  const history = await db.select().from(rulesHistory).orderBy(desc(rulesHistory.version));
  const past: RulesVersion[] = history.map((h) => ({
    version: h.version,
    document: parseRulesDocument(h.document, `history version ${h.version}`),
    by: h.changedBy,
    at: h.changedAt,
  }));
  return { current, all: [current, ...past] };
}

/** The current rules document only (no version metadata). */
export async function getRuleSet(db: Db): Promise<Rules> {
  return (await getRules(db)).document;
}

export type SaveRulesResult =
  | { status: "saved"; version: number; changes: ReturnType<typeof diffRules> }
  | { status: "unchanged" }
  | { status: "conflict"; currentVersion: number };

/**
 * Saves a new version of the rules. One SQL statement, so it is atomic:
 * archives the previous version into rules_history, bumps the version, and
 * writes the audit log. `expectedVersion` makes concurrent edits safe: if
 * someone else saved first, nothing is written and a conflict is returned.
 */
export async function saveRules(
  db: Db,
  args: { document: Rules; actor: string; expectedVersion: number },
): Promise<SaveRulesResult> {
  const document = parseRulesDocument(args.document, "proposed");
  const current = await getRules(db);
  if (current.version !== args.expectedVersion) {
    return { status: "conflict", currentVersion: current.version };
  }
  const changes = diffRules(current.document, document);
  if (changes.length === 0) return { status: "unchanged" };

  const detail = {
    from_version: args.expectedVersion,
    to_version: args.expectedVersion + 1,
    changes,
  };
  // Everything is driven by `upd`, so history and audit rows exist only if the
  // update really happened. A concurrent loser re-checks `version` after the
  // winner commits, matches nothing, and therefore writes nothing at all.
  const result = await db.execute(sql`
    with upd as (
      update rules r
      set document = ${JSON.stringify(document)}::jsonb,
          version = r.version + 1,
          updated_by = ${args.actor},
          updated_at = now()
      from (
        select version, document, updated_by, updated_at
        from rules where id = 1 and version = ${args.expectedVersion}
      ) old
      where r.id = 1 and r.version = ${args.expectedVersion}
      returning r.version as new_version,
                old.version as old_version, old.document as old_document,
                old.updated_by as old_by, old.updated_at as old_at
    ),
    hist as (
      insert into rules_history (version, document, changed_by, changed_at)
      select old_version, old_document, old_by, old_at from upd
      returning 1
    ),
    aud as (
      insert into audit_log (actor, action, detail)
      select ${args.actor}, 'rules.update', ${JSON.stringify(detail)}::jsonb from upd
      returning 1
    )
    select (select new_version from upd) as new_version
  `);

  const newVersion = result.rows[0]?.new_version as number | null | undefined;
  if (newVersion == null) {
    // Lost a race between the check above and the write: nothing was written.
    const latest = await getRules(db);
    return { status: "conflict", currentVersion: latest.version };
  }
  return { status: "saved", version: newVersion, changes };
}

// ---------------------------------------------------------------------------
// System state (pause flag)
// ---------------------------------------------------------------------------

/** Earliest and latest inventory snapshot dates, or null if there is none. */
export async function getInventoryDateRange(db: Db): Promise<{ first: string; last: string } | null> {
  const [row] = await db
    .select({ first: sql<string | null>`min(${inventory.asOfDate})`, last: sql<string | null>`max(${inventory.asOfDate})` })
    .from(inventory);
  return row?.first && row.last ? { first: row.first, last: row.last } : null;
}

export async function getSystemState(db: Db) {
  const [row] = await db.select().from(systemState).where(eq(systemState.id, 1));
  if (!row) throw new Error("system_state row is missing. Run `npm run seed`.");
  return row;
}

// ---------------------------------------------------------------------------
// Engine input
// ---------------------------------------------------------------------------

export interface LoadedEngineInput {
  input: EngineInput;
  rulesVersion: number;
  /** Date of the inventory snapshot used. */
  inventoryAsOf: string;
}

/**
 * Builds the engine's input from Neon. Rules come from the rules table (or
 * `opts.rules` for a what-if preview). The as-of date defaults to the latest
 * inventory snapshot; the snapshot used is the latest one on or before it.
 */
export async function loadEngineInput(
  db: Db,
  opts: { asOfDate?: string; rules?: Rules } = {},
): Promise<LoadedEngineInput> {
  const current = await getRules(db);

  const [latest] = await db.select({ d: max(inventory.asOfDate) }).from(inventory);
  const asOfDate = opts.asOfDate ?? latest?.d;
  if (!asOfDate) throw new Error("No inventory data found. Run `npm run seed`.");

  const [snap] = await db
    .select({ d: max(inventory.asOfDate) })
    .from(inventory)
    .where(lte(inventory.asOfDate, asOfDate));
  if (!snap?.d) {
    throw new AsOfDateError(`There is no stock data on or before ${asOfDate}. Choose a date on or after the first inventory snapshot.`);
  }
  const inventoryAsOf = snap.d;

  const rules = opts.rules ?? current.document;
  const [skuRows, salesRows, inventoryRows, calendarRows] = await Promise.all([
    db.select().from(skus).orderBy(skus.skuId),
    db.select().from(weeklySales),
    db.select().from(inventory).where(eq(inventory.asOfDate, inventoryAsOf)),
    db.select().from(calendar),
  ]);

  const input: EngineInput = {
    asOfDate,
    skus: skuRows.map((s) => ({
      skuId: s.skuId,
      skuName: s.skuName,
      category: s.category,
      perishability: s.perishability,
      standardReorderQty: s.standardReorderQty,
      distributorId: s.distributorId,
    })),
    sales: salesRows.map((w) => ({ skuId: w.skuId, isoWeek: w.isoWeek, units: w.units })),
    inventory: inventoryRows.map((i) => ({ skuId: i.skuId, unitsOnHand: i.unitsOnHand })),
    calendar: calendarRows.map((c) => ({ year: c.year, month: c.month, isFestivalMonth: c.isFestivalMonth })),
    rules,
    // Confirmed, active event tags that still touch the baseline window (older ones have expired).
    events: await loadActiveEventTags(db, windowWeeks(asOfDate, rules.baseline_weeks)[0]),
  };
  return { input, rulesVersion: current.version, inventoryAsOf };
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function listRuns(db: Db, limit = 50) {
  return db
    .select({
      id: runs.id,
      trigger: runs.trigger,
      status: runs.status,
      asOfDate: runs.asOfDate,
      startedAt: runs.startedAt,
      submittedAt: runs.submittedAt,
      overrideRate: runs.overrideRate,
      skipReason: runs.skipReason,
      error: runs.error,
      rulesVersion: runs.rulesVersion,
      items: sql<number>`count(${runItems.skuId})::int`,
      edge: sql<number>`(count(*) filter (where ${runItems.isEdge}))::int`,
    })
    .from(runs)
    .leftJoin(runItems, eq(runItems.runId, runs.id))
    .groupBy(runs.id)
    .orderBy(desc(runs.startedAt))
    .limit(limit);
}

/** A run with every SKU's result, or null if it does not exist. */
export async function getRunDetail(db: Db, id: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) return null;
  const items = await db
    .select({
      item: runItems,
      skuName: skus.skuName,
      category: skus.category,
      perishability: skus.perishability,
      standardReorderQty: skus.standardReorderQty,
      distributorId: skus.distributorId,
    })
    .from(runItems)
    .innerJoin(skus, eq(skus.skuId, runItems.skuId))
    .where(eq(runItems.runId, id))
    .orderBy(runItems.skuId);
  return { run, items };
}
