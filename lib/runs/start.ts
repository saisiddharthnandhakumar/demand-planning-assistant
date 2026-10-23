import { runEngine } from "@/lib/engine";
import type { EngineInput, EngineResult, EventTag } from "@/lib/engine/types";
import type { EdgeBrief } from "@/lib/gemini/service";
import { fallbackBrief } from "./briefs";
import type { Rules } from "@/lib/rules";
import { AsOfDateError } from "./errors";
import { engineItemToRow, type RunItemRow } from "./map";

export type RunTrigger = "cron" | "manual";

/** A second start for the same trigger and as-of date within this window returns the first run. */
export const DUPLICATE_WINDOW_MS = 60_000;

export type StartRunResult =
  | { status: "started"; runId: string; asOfDate: string; summary: EngineResult["summary"] }
  | { status: "existing"; runId: string }
  | { status: "skipped"; runId: string; reason: string }
  /** The request itself was unusable (bad as-of date). Nothing was stored. */
  | { status: "invalid"; error: string }
  | { status: "failed"; runId: string | null; error: string };

export interface OpenRun {
  id: string;
  trigger: RunTrigger;
  asOfDate: string;
  rulesVersion: number;
  rulesSnapshot: Rules;
  eventsSnapshot: EventTag[];
  items: RunItemRow[];
}

export interface RecordedNonRun {
  id: string;
  trigger: RunTrigger;
  status: "skipped" | "failed";
  asOfDate?: string;
  skipReason?: string;
  error?: string;
}

/** Everything the pipeline needs from the outside world, so it can be tested without a database. */
export interface RunDeps {
  getSystemState(): Promise<{ paused: boolean; reason: string | null; since: Date | null }>;
  loadInput(asOfDate?: string): Promise<{
    input: Parameters<typeof runEngine>[0];
    rulesVersion: number;
  }>;
  /** Id of an open run with the same trigger and as-of date started at or after `since`. */
  findRecentOpenRun(args: { trigger: RunTrigger; asOfDate: string; since: Date }): Promise<string | null>;
  /**
   * Writes a brief for every edge SKU. Gemini is only ever used here and for
   * event notes. It may be slow or down: callers must not depend on it succeeding.
   */
  writeBriefs(result: EngineResult, input: EngineInput): Promise<Map<string, EdgeBrief>>;
  /** Atomically stores the run, its items and an audit entry, or nothing. */
  saveOpenRun(run: OpenRun): Promise<void>;
  /** Stores a skipped or failed run (no items). */
  saveNonRun(run: RecordedNonRun): Promise<void>;
  now(): Date;
  newId(): string;
}

const describePause = (s: { reason: string | null; since: Date | null }) =>
  `System is paused${s.reason ? `: ${s.reason}` : ""}. No run was computed.`;

/**
 * The one code path for both the cron and the manual "Run now" button.
 * First action: read the pause flag. If paused, record a skipped run and stop
 * without computing anything. Otherwise compute with the deterministic engine
 * and store the run and every SKU's result in one atomic write.
 */
export async function startRun(
  deps: RunDeps,
  args: { trigger: RunTrigger; asOfDate?: string },
): Promise<StartRunResult> {
  const { trigger } = args;

  const state = await deps.getSystemState();
  if (state.paused) {
    const reason = describePause(state);
    const id = deps.newId();
    await deps.saveNonRun({ id, trigger, status: "skipped", skipReason: reason });
    return { status: "skipped", runId: id, reason };
  }

  try {
    const { input, rulesVersion } = await deps.loadInput(args.asOfDate);

    const duplicate = await deps.findRecentOpenRun({
      trigger,
      asOfDate: input.asOfDate,
      since: new Date(deps.now().getTime() - DUPLICATE_WINDOW_MS),
    });
    if (duplicate) return { status: "existing", runId: duplicate };

    const result = runEngine(input);

    // The AI step can never fail a run: any problem leaves the deterministic brief in its place.
    let briefs = new Map<string, EdgeBrief>();
    try {
      briefs = await deps.writeBriefs(result, input);
    } catch {
      /* every edge item still gets a template brief below */
    }

    const id = deps.newId();
    await deps.saveOpenRun({
      id,
      trigger,
      asOfDate: result.asOfDate,
      rulesVersion,
      rulesSnapshot: input.rules,
      eventsSnapshot: input.events ?? [],
      items: result.items.map((item) =>
        engineItemToRow(id, item, item.isEdge ? (briefs.get(item.skuId) ?? fallbackBrief(item, input, "The AI brief step did not complete.")) : undefined),
      ),
    });
    return { status: "started", runId: id, asOfDate: result.asOfDate, summary: result.summary };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (err instanceof AsOfDateError) return { status: "invalid", error };
    try {
      const id = deps.newId();
      await deps.saveNonRun({ id, trigger, status: "failed", error, asOfDate: args.asOfDate });
      return { status: "failed", runId: id, error };
    } catch {
      // The database itself is unavailable, so the failure cannot be recorded.
      return { status: "failed", runId: null, error };
    }
  }
}
