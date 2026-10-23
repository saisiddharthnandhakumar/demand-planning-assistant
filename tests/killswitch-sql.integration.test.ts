import { config } from "dotenv";
import { eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { auditLog, systemState } from "@/lib/db/schema";
import { nextKillState, pauseReason, type KillConfig, type KillState, type RunVerdict } from "@/lib/killswitch";
import { killSwitchCtes } from "@/lib/runs/kill-sql";

// OPT-IN integration test. The kill switch rules exist twice: as the pure
// nextKillState() and as SQL (killSwitchCtes) so that evaluating a run is atomic
// with submitting it. This drives both through long random sequences and
// requires them to agree on every step.
//
// It WRITES to system_state and deletes system.* audit rows, so it only runs when
// TEST_DATABASE_URL is set, and that must be a development or branch database:
//   TEST_DATABASE_URL="$(grep ^DATABASE_URL= .env.local | cut -d= -f2-)" npx vitest run killswitch-sql
config({ path: ".env.local", quiet: true });
const url = process.env.TEST_DATABASE_URL;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const verdictFrom = (r: number): RunVerdict => (r < 0.5 ? "breach" : r < 0.85 ? "clean" : "no_data");
const RUNNING: KillState = { paused: false, consecutiveBreaches: 0, breachRunIds: [] };

describe.skipIf(!url)("kill switch SQL matches the pure function", () => {
  const db = url ? getDb(url) : (undefined as never);
  const reset = () =>
    db.update(systemState).set({ paused: false, reason: null, since: null, consecutiveBreaches: 0, breachRunIds: [] }).where(eq(systemState.id, 1));
  const cleanAudit = () => db.delete(auditLog).where(like(auditLog.action, "system.%"));

  beforeAll(async () => {
    await reset();
    await cleanAudit();
  });
  afterAll(async () => {
    await reset();
    await cleanAudit();
  });

  async function apply(verdict: RunVerdict, runId: string, config: KillConfig) {
    const kill = killSwitchCtes({ verdict, runId, config });
    const r = await db.execute(sql`
      with sub as (select ${runId}::uuid as id),
      ${kill}
      select (select now_paused from ks) as now_paused, (select was_paused from ks) as was_paused
    `);
    return { nowPaused: Boolean(r.rows[0].now_paused), wasPaused: Boolean(r.rows[0].was_paused) };
  }

  const cases: [seed: number, streak: number][] = [[1, 2], [2, 2], [3, 1], [4, 3], [5, 2]];
  it.each(cases)("seed %i, streak length %i: 40 random steps with occasional resumes", async (seed, n) => {
    const config: KillConfig = { threshold: 0.3, consecutiveRuns: n };
    const rand = rng(seed);
    await reset();
    await cleanAudit();

    let pure = RUNNING;
    let pausedSince: number | null = null;
    let expectedPauses = 0;

    for (let i = 0; i < 40; i++) {
      if (pure.paused && rand() < 0.35) {
        await reset(); // what the resume flow does
        pure = RUNNING;
        pausedSince = null;
      }
      const verdict = verdictFrom(rand());
      const runId = crypto.randomUUID();
      const t = nextKillState(pure, verdict, runId, config);
      const res = await apply(verdict, runId, config);
      pure = t.state;

      const [row] = await db.select().from(systemState).where(eq(systemState.id, 1));
      expect({ paused: row.paused, n: row.consecutiveBreaches, ids: row.breachRunIds }).toEqual({
        paused: pure.paused,
        n: pure.consecutiveBreaches,
        ids: pure.breachRunIds,
      });
      expect(res.nowPaused).toBe(pure.paused);
      expect(res.nowPaused && !res.wasPaused).toBe(t.justPaused);

      if (t.justPaused) {
        expectedPauses++;
        expect(row.reason).toBe(pauseReason(config.threshold, n));
        expect(row.since).toBeInstanceOf(Date);
        pausedSince = row.since!.getTime();
      }
      if (row.paused && pausedSince !== null) expect(row.since!.getTime()).toBe(pausedSince); // `since` never moves while paused
    }

    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "system.pause"));
    expect(audits).toHaveLength(expectedPauses); // exactly one audit row per running -> paused transition
  }, 120_000);
});
