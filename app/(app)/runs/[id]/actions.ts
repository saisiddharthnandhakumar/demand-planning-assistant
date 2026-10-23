"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import type { DecisionInput } from "@/lib/decisions";
import { bulkApproveUntouched, decideItem, submitRun } from "@/lib/runs/decisions-db";
import { requireAuth } from "@/lib/session";

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const runIdSchema = z.uuid();
const skuIdSchema = z.string().min(1).max(40);
const nameSchema = z.string().trim().min(1, "Enter your name.").max(80, "Keep your name under 80 characters.");

function refresh(runId: string) {
  revalidatePath(`/runs/${runId}`);
  revalidatePath("/runs");
}

/** The pause banner lives in the shared layout, so a submit that may pause the system refreshes every page. */
function refreshEverything() {
  revalidatePath("/", "layout");
}

/** Approve, edit, reject or clear one engine decision, or decide one edge SKU. */
export async function decideAction(runId: string, skuId: string, input: DecisionInput): Promise<ActionResult> {
  await requireAuth();
  if (!runIdSchema.safeParse(runId).success || !skuIdSchema.safeParse(skuId).success) {
    return { ok: false, error: "Invalid request." };
  }
  const result = await decideItem(getDb(), runId, skuId, input);
  if (result.ok) refresh(runId);
  return result;
}

/** Approves every untouched engine decision, but only if the count still matches what was confirmed. */
export async function bulkApproveAction(runId: string, expectedCount: number): Promise<ActionResult> {
  await requireAuth();
  if (!runIdSchema.safeParse(runId).success || !Number.isInteger(expectedCount) || expectedCount < 0) {
    return { ok: false, error: "Invalid request." };
  }
  const result = await bulkApproveUntouched(getDb(), runId, expectedCount);
  if (!result.ok) return result;
  refresh(runId);
  return { ok: true, message: `Approved ${result.approved} engine decisions.` };
}

/** Submits and locks the run. */
export async function submitAction(runId: string, name: string): Promise<ActionResult> {
  await requireAuth();
  const parsedName = nameSchema.safeParse(name);
  if (!runIdSchema.safeParse(runId).success) return { ok: false, error: "Invalid request." };
  if (!parsedName.success) return { ok: false, error: parsedName.error.issues[0].message, fieldErrors: { name: parsedName.error.issues[0].message } };

  const result = await submitRun(getDb(), { runId, submittedBy: parsedName.data });
  if (!result.ok) return result;
  refresh(runId);
  refreshEverything();
  return {
    ok: true,
    message: result.kill.justPaused
      ? `Run submitted and locked. This was run ${result.kill.consecutiveBreaches} in a row above the override limit, so the system has paused itself.`
      : "Run submitted and locked.",
  };
}
