import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { resumeSchema, type ResumeInput } from "@/lib/killswitch";

export type ResumeResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Resumes a paused system. Needs the typed confirmation and a written reason;
 * both are written to audit_log together with who asked and what the pause was
 * about. The breach counter and the recorded runs are reset in the same
 * statement. If the system is not paused nothing changes.
 */
export async function resumeSystem(db: Db, input: ResumeInput): Promise<ResumeResult> {
  const parsed = resumeSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, error: parsed.error.issues[0].message, fieldErrors };
  }
  const { confirmation, reason, actor } = parsed.data;

  const result = await db.execute(sql`
    with upd as (
      update system_state s
      set paused = false, reason = null, since = null, consecutive_breaches = 0, breach_run_ids = '[]'::jsonb
      from (select reason, since, breach_run_ids from system_state where id = 1) old
      where s.id = 1 and s.paused
      returning old.reason as old_reason, old.since as old_since, old.breach_run_ids as old_run_ids
    ),
    aud as (
      insert into audit_log (actor, action, detail)
      select ${actor}::text, 'system.resume',
             jsonb_build_object('typedConfirmation', ${confirmation}::text, 'reason', ${reason}::text,
                                'previousReason', old_reason, 'pausedSince', old_since, 'breachRunIds', old_run_ids)
      from upd
      returning 1
    )
    select count(*)::int as n from upd
  `);
  if (Number(result.rows[0]?.n ?? 0) === 0) return { ok: false, error: "The system is not paused, so there is nothing to resume." };
  return { ok: true };
}
