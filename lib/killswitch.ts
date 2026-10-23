import { z } from "zod";

// Kill switch semantics, as pure functions. The same rules are expressed in SQL
// in lib/runs/kill-sql.ts (so evaluating a run is atomic with submitting it);
// tests/killswitch-sql.* drives both over long scripted sequences and checks
// they always agree.

export interface KillState {
  paused: boolean;
  consecutiveBreaches: number;
  /** Runs in the current streak of breaches, oldest first. */
  breachRunIds: string[];
}

export interface KillConfig {
  /** A run is a breach when its override rate is strictly above this fraction. */
  threshold: number;
  /** Consecutive breaching runs that trigger the pause. */
  consecutiveRuns: number;
}

/**
 * - breach: override rate above the threshold.
 * - clean: a rate at or below the threshold.
 * - no_data: no engine decisions in the run (every SKU was routed to the
 *   planner), so there is no rate to judge. It neither extends nor breaks a streak.
 */
export type RunVerdict = "breach" | "clean" | "no_data";

export function verdictFor(rate: number | null, threshold: number): RunVerdict {
  if (rate === null) return "no_data";
  return rate > threshold ? "breach" : "clean";
}

export interface KillTransition {
  state: KillState;
  /** True only on the transition from running to paused. */
  justPaused: boolean;
}

/**
 * The state after a run is submitted. Evaluated once per submitted run:
 * - a breach extends the streak, and pauses the system when the streak reaches
 *   `consecutiveRuns`;
 * - a clean run resets the streak;
 * - a run with no rate leaves the streak alone;
 * - an already paused system is left exactly as it is.
 */
export function nextKillState(state: KillState, verdict: RunVerdict, runId: string, config: KillConfig): KillTransition {
  if (state.paused || verdict === "no_data") return { state, justPaused: false };
  if (verdict === "clean") {
    return { state: { paused: false, consecutiveBreaches: 0, breachRunIds: [] }, justPaused: false };
  }
  const consecutiveBreaches = state.consecutiveBreaches + 1;
  const paused = consecutiveBreaches >= config.consecutiveRuns;
  return {
    state: { paused, consecutiveBreaches, breachRunIds: [...state.breachRunIds, runId] },
    justPaused: paused,
  };
}

/** The text stored as the pause reason. The runs involved are stored alongside it. */
export function pauseReason(threshold: number, consecutiveRuns: number): string {
  const pct = Math.round(threshold * 1000) / 10;
  return `Override rate above ${pct}% in ${consecutiveRuns} consecutive submitted runs.`;
}

/** "30%" or "27.5%": a fraction as a tidy percentage. */
export const formatPct = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;

/**
 * What the planner should know before submitting a run that is above the limit,
 * worded from the real rules and the current streak. Null when the run is not a breach.
 */
export function breachWarning(args: { rate: number | null; threshold: number; consecutiveRuns: number; currentStreak: number }): string | null {
  if (verdictFor(args.rate, args.threshold) !== "breach") return null;
  const limit = formatPct(args.threshold);
  const position = args.currentStreak + 1;
  if (position >= args.consecutiveRuns) {
    return args.consecutiveRuns === 1
      ? `This rate is above ${limit}. A single run above the limit pauses the system, so submitting this run will pause it.`
      : `This rate is above ${limit}. This would be run ${position} of ${args.consecutiveRuns} in a row above the limit, so submitting it will pause the system.`;
  }
  return `This rate is above ${limit}. This would be run ${position} of ${args.consecutiveRuns} in a row above the limit; the system pauses at ${args.consecutiveRuns}. A run at or below the limit resets the count.`;
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

export const RESUME_CONFIRMATION = "RESUME";
export const MIN_RESUME_REASON_LENGTH = 10;

export const resumeSchema = z.object({
  confirmation: z.string().refine((v) => v === RESUME_CONFIRMATION, `Type ${RESUME_CONFIRMATION} exactly to confirm.`),
  reason: z
    .string()
    .trim()
    .min(MIN_RESUME_REASON_LENGTH, `Write a reason of at least ${MIN_RESUME_REASON_LENGTH} characters.`)
    .max(1000, "Keep the reason under 1000 characters."),
  actor: z.string().trim().min(1, "Enter your name.").max(80, "Keep your name under 80 characters."),
});

export type ResumeInput = z.input<typeof resumeSchema>;
