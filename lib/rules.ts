import { z } from "zod";

/**
 * The editable rules document. Stored as JSON in the `rules` table (M3) so the
 * planner can change thresholds without a deploy. The engine receives a
 * validated Rules object as an argument and has no thresholds of its own.
 */
export const rulesSchema = z
  .object({
    surge_threshold: z.number().min(0),
    surge_recent_weeks: z.number().int().min(1),
    baseline_weeks: z.number().int().min(2),
    surge_reorder_multiplier: z.number().positive(),
    stockout_weeks: z.number().positive(),
    overstock_weeks: z.number().positive(),
    festival_uplift: z.number().min(0),
    perishable: z
      .object({
        min_weeks: z.number().positive(),
        max_weeks: z.number().positive(),
      })
      .strict(),
    edge: z
      .object({
        min_history_weeks: z.number().int().min(1),
        step_change_threshold: z.number().min(0),
        outlier_zscore: z.number().positive(),
        distributor_swing_threshold: z.number().min(0),
      })
      .strict(),
    kill: z
      .object({
        override_rate_threshold: z.number().min(0).max(1),
        consecutive_runs: z.number().int().min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.surge_recent_weeks >= r.baseline_weeks) {
      ctx.addIssue({
        code: "custom",
        path: ["surge_recent_weeks"],
        message: "surge_recent_weeks must be smaller than baseline_weeks",
      });
    }
    if (r.stockout_weeks >= r.overstock_weeks) {
      ctx.addIssue({
        code: "custom",
        path: ["stockout_weeks"],
        message: "stockout_weeks must be smaller than overstock_weeks",
      });
    }
    if (r.perishable.min_weeks >= r.perishable.max_weeks) {
      ctx.addIssue({
        code: "custom",
        path: ["perishable", "min_weeks"],
        message: "perishable.min_weeks must be smaller than perishable.max_weeks",
      });
    }
  });

export type Rules = z.infer<typeof rulesSchema>;

/**
 * The starting document loaded into the rules table in M3. Not read by the
 * engine at runtime; tests use it as a fixed input.
 */
export const INITIAL_RULES: Rules = {
  surge_threshold: 0.2,
  surge_recent_weeks: 4,
  baseline_weeks: 12,
  surge_reorder_multiplier: 1.5,
  stockout_weeks: 6,
  overstock_weeks: 14,
  festival_uplift: 0.25,
  perishable: { min_weeks: 3, max_weeks: 4 },
  edge: {
    min_history_weeks: 12,
    step_change_threshold: 0.3,
    outlier_zscore: 2.5,
    distributor_swing_threshold: 0.3,
  },
  kill: { override_rate_threshold: 0.3, consecutive_runs: 2 },
};
