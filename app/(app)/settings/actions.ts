"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import type { ResumeInput } from "@/lib/killswitch";
import { resumeSystem, type ResumeResult } from "@/lib/runs/resume-db";
import { requireAuth } from "@/lib/session";

/** Resumes a paused system. Needs the typed confirmation and a written reason; both are logged. */
export async function resumeAction(input: ResumeInput): Promise<ResumeResult> {
  await requireAuth();
  const result = await resumeSystem(getDb(), input);
  // the pause banner is in the shared layout, so refresh every page
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
