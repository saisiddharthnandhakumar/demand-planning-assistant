"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { saveQuarterLoss } from "@/lib/db/dashboard";
import { ENTRY_QUARTER_COUNT, parseQuarterKey, parseRupees, quarterKey, quarterOfDate, recentQuarters, todayInIst } from "@/lib/money";
import { requireAuth } from "@/lib/session";

export type LossResult =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const inputSchema = z.object({
  quarter: z.string(),
  stockout: z.string(),
  writeoff: z.string(),
  name: z.string().trim().min(1, "Enter your name.").max(80, "Keep your name under 80 characters."),
});

export async function saveLossAction(input: z.input<typeof inputSchema>): Promise<LossResult> {
  await requireAuth();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, error: parsed.error.issues[0].message, fieldErrors };
  }
  const { quarter, stockout, writeoff, name } = parsed.data;

  const allowed = recentQuarters(quarterOfDate(todayInIst(new Date())), ENTRY_QUARTER_COUNT).map(quarterKey);
  const q = parseQuarterKey(quarter);
  if (!q || !allowed.includes(quarter)) return { ok: false, error: "Choose one of the listed quarters.", fieldErrors: { quarter: "Choose one of the listed quarters." } };

  const stockoutLossInr = parseRupees(stockout);
  const writeoffLossInr = parseRupees(writeoff);
  const fieldErrors: Record<string, string> = {};
  if (stockoutLossInr === null) fieldErrors.stockout = "Enter whole rupees, for example 2000000 or 20,00,000.";
  if (writeoffLossInr === null) fieldErrors.writeoff = "Enter whole rupees, for example 1100000 or 11,00,000.";
  if (stockoutLossInr === null || writeoffLossInr === null) return { ok: false, error: "Check the amounts.", fieldErrors };

  await saveQuarterLoss(getDb(), { quarter: q, stockoutLossInr, writeoffLossInr, enteredBy: name });
  revalidatePath("/dashboard");
  return { ok: true, message: `Saved ${quarter}.` };
}
