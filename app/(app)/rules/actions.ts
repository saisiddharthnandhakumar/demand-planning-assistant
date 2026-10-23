"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { getRules, loadEngineInput, saveRules } from "@/lib/db/queries";
import { runEngine } from "@/lib/engine";
import { compareResults, type DecisionChange } from "@/lib/engine/compare";
import { parseRulesForm } from "@/lib/rules-form";
import { diffRules, type RuleChange } from "@/lib/rules-timeline";
import { requireAuth } from "@/lib/session";

export type FieldErrors = Record<string, string>;

export interface PreviewState {
  status: "idle" | "ok" | "error";
  message?: string;
  errors?: FieldErrors;
  totalSkus?: number;
  ruleChanges?: RuleChange[];
  changes?: DecisionChange[];
  skuNames?: Record<string, string>;
}

export interface SaveState {
  status: "idle" | "saved" | "unchanged" | "conflict" | "error";
  message?: string;
  errors?: FieldErrors;
}

const MAX_NAME = 80;

/** Shows how decisions on the current data would change under the edited rules. Writes nothing. */
export async function previewRules(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  await requireAuth();
  const parsed = parseRulesForm(Object.fromEntries(formData));
  if (!parsed.ok) return { status: "error", errors: parsed.errors, message: "Fix the highlighted fields first." };

  const db = getDb();
  const { input, rulesVersion } = await loadEngineInput(db);
  const current = await getRules(db);
  const before = runEngine(input);
  const after = runEngine({ ...input, rules: parsed.rules });
  return {
    status: "ok",
    totalSkus: input.skus.length,
    ruleChanges: diffRules(current.document, parsed.rules),
    changes: compareResults(before, after),
    skuNames: Object.fromEntries(input.skus.map((s) => [s.skuId, s.skuName])),
    message: `Compared with saved version ${rulesVersion}, as of ${input.asOfDate}.`,
  };
}

export async function saveRulesAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  await requireAuth();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { status: "error", errors: { name: "Enter your name so the change is attributed." } };
  if (name.length > MAX_NAME) return { status: "error", errors: { name: `Keep it under ${MAX_NAME} characters.` } };

  const expectedVersion = Number(formData.get("version"));
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { status: "error", message: "Missing rules version. Reload the page and try again." };
  }

  const parsed = parseRulesForm(Object.fromEntries(formData));
  if (!parsed.ok) return { status: "error", errors: parsed.errors, message: "Fix the highlighted fields first." };

  const result = await saveRules(getDb(), { document: parsed.rules, actor: name, expectedVersion });
  switch (result.status) {
    case "saved":
      revalidatePath("/rules");
      return { status: "saved", message: `Saved as version ${result.version}. It applies from the next run.` };
    case "unchanged":
      return { status: "unchanged", message: "Nothing to save: these values match the current rules." };
    case "conflict":
      return {
        status: "conflict",
        message: `Someone else saved version ${result.currentVersion} while you were editing. Reload to see it, then reapply your change.`,
      };
  }
}
