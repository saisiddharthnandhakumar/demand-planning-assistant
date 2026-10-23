"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isValidIsoDate } from "@/lib/dates";
import { startRunWithDb } from "@/lib/runs/db-deps";
import { requireAuth } from "@/lib/session";

export interface RunNowState {
  error?: string;
}

const asOfSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || isValidIsoDate(v), "Enter a valid date.");

/** The manual "Run now": same pipeline as the cron, with an optional as-of override. */
export async function runNow(_prev: RunNowState, formData: FormData): Promise<RunNowState> {
  await requireAuth();

  const parsed = asOfSchema.safeParse(formData.get("asOfDate") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const result = await startRunWithDb({ trigger: "manual", asOfDate: parsed.data || undefined });
  switch (result.status) {
    case "started":
    case "existing":
      redirect(`/runs/${result.runId}`);
    case "skipped":
      return { error: result.reason };
    case "invalid":
      return { error: result.error };
    case "failed":
      return { error: `The run failed: ${result.error}` };
  }
}
