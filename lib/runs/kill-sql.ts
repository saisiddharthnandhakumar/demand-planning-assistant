import { sql, type SQL } from "drizzle-orm";
import { pauseReason, type KillConfig, type RunVerdict } from "@/lib/killswitch";

/**
 * The kill switch rules from lib/killswitch.ts as two SQL CTEs, `ks` and `kaud`.
 * They are meant to be placed after a CTE named `sub` (one row, column `id`,
 * produced only when a run was really submitted), so evaluating a run is atomic
 * with submitting it and can neither be skipped nor applied twice.
 *
 * Keep this in step with nextKillState(); the tests drive both over long
 * scripted sequences and require them to agree.
 */
export function killSwitchCtes(args: { verdict: RunVerdict; runId: string; config: KillConfig }): SQL {
  const breach = args.verdict === "breach";
  const clean = args.verdict === "clean";
  const reason = pauseReason(args.config.threshold, args.config.consecutiveRuns);
  const n = args.config.consecutiveRuns;
  return sql`
    ks as (
      update system_state s
      set consecutive_breaches = case
            when s.paused then s.consecutive_breaches
            when ${clean}::boolean then 0
            when ${breach}::boolean then s.consecutive_breaches + 1
            else s.consecutive_breaches end,
          breach_run_ids = case
            when s.paused then s.breach_run_ids
            when ${clean}::boolean then '[]'::jsonb
            when ${breach}::boolean then s.breach_run_ids || to_jsonb(${args.runId}::text)
            else s.breach_run_ids end,
          paused = s.paused or (${breach}::boolean and s.consecutive_breaches + 1 >= ${n}::int),
          reason = case when not s.paused and ${breach}::boolean and s.consecutive_breaches + 1 >= ${n}::int
                        then ${reason}::text else s.reason end,
          since = case when not s.paused and ${breach}::boolean and s.consecutive_breaches + 1 >= ${n}::int
                       then now() else s.since end
      from sub, (select paused as was_paused from system_state where id = 1) old
      where s.id = 1
      returning s.paused as now_paused, old.was_paused as was_paused,
                s.consecutive_breaches as consecutive_breaches, s.breach_run_ids as breach_run_ids,
                s.reason as reason
    ),
    kaud as (
      insert into audit_log (actor, action, detail)
      select 'system', 'system.pause',
             jsonb_build_object('reason', reason, 'runIds', breach_run_ids, 'consecutiveBreaches', consecutive_breaches)
      from ks
      where now_paused and not was_paused
      returning 1
    )
  `;
}
