import { z } from "zod";

// What Approve, Edit, Reject and "decide" (edge SKUs) do to a run item. Pure:
// the database layer applies the result; this module only decides what it is.

export const REASON_CATEGORIES = [
  { value: "demand_view_differs", label: "Demand view differs" },
  { value: "supplier_constraint", label: "Supplier constraint" },
  { value: "market_event", label: "Market event" },
  { value: "data_issue", label: "Data issue" },
  { value: "other", label: "Other" },
] as const;

export type ReasonCategory = (typeof REASON_CATEGORIES)[number]["value"];
const reasonValues = REASON_CATEGORIES.map((r) => r.value) as [ReasonCategory, ...ReasonCategory[]];

export const reasonLabel = (value: string | null | undefined) =>
  REASON_CATEGORIES.find((r) => r.value === value)?.label ?? value ?? "";

export const DECISION_ACTIONS = ["REORDER_NOW", "REORDER", "PAUSE_ORDER", "NO_ACTION"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export const isOrderAction = (a: string | null | undefined): boolean => a === "REORDER_NOW" || a === "REORDER";

export const MAX_QTY = 1_000_000; // a typo guard, not a business limit
export const MAX_NOTE_LENGTH = 500;

const actionSchema = z.enum(DECISION_ACTIONS, { error: "Choose an action." });
const reasonSchema = z.enum(reasonValues, { error: "Choose a reason." });
const qtySchema = z
  .number({ error: "Enter a quantity." })
  .int("Quantity must be a whole number.")
  .min(0, "Quantity cannot be negative.")
  .max(MAX_QTY, `Quantity cannot exceed ${MAX_QTY.toLocaleString("en-IN")}.`)
  .nullish();
const noteSchema = z
  .string()
  .trim()
  .max(MAX_NOTE_LENGTH, `Keep the note under ${MAX_NOTE_LENGTH} characters.`)
  .nullish()
  .transform((v) => v || null);

export const decisionInputSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({ decision: z.literal("clear") }),
  z.object({ decision: z.literal("reject"), reasonCategory: reasonSchema, note: noteSchema }),
  z.object({ decision: z.literal("edit"), action: actionSchema, qty: qtySchema, reasonCategory: reasonSchema, note: noteSchema }),
  z.object({ decision: z.literal("decide"), action: actionSchema, qty: qtySchema, reasonCategory: reasonSchema, note: noteSchema }),
]);

export type DecisionInput = z.input<typeof decisionInputSchema>;
export type ParsedDecision = z.output<typeof decisionInputSchema>;

export type DecisionStatus = "pending" | "approved" | "edited" | "rejected";

/** The columns a decision writes on a run item. */
export interface DecisionUpdate {
  decisionStatus: DecisionStatus;
  finalAction: DecisionAction | null;
  finalQty: number | null;
  overrideReason: ReasonCategory | null;
  overrideNote: string | null;
}

export type DecisionResult = { ok: true; update: DecisionUpdate } | { ok: false; error: string };

const fail = (error: string): DecisionResult => ({ ok: false, error });

/**
 * Turns a validated decision into the update for one item.
 *
 * Engine items accept approve, edit, reject and clear. Edge items accept only
 * "decide" and clear: the planner must choose action, quantity and reason
 * himself, so nothing is prefilled from the rules' reference answer.
 */
export function buildDecision(
  input: ParsedDecision,
  item: { isEdge: boolean; recommendedAction: string | null; recommendedQty: number | null },
): DecisionResult {
  if (input.decision === "clear") {
    return { ok: true, update: { decisionStatus: "pending", finalAction: null, finalQty: null, overrideReason: null, overrideNote: null } };
  }

  if (item.isEdge) {
    if (input.decision !== "decide") return fail("This SKU needs your judgment: choose the action, quantity and reason yourself.");
  } else if (input.decision === "decide") {
    return fail("This SKU has an engine decision. Use Approve, Edit or Reject.");
  }

  switch (input.decision) {
    case "approve": {
      if (!item.recommendedAction) return fail("There is no recommendation to approve.");
      return {
        ok: true,
        update: {
          decisionStatus: "approved",
          finalAction: item.recommendedAction as DecisionAction,
          finalQty: item.recommendedQty ?? 0,
          overrideReason: null,
          overrideNote: null,
        },
      };
    }

    case "reject": {
      if (item.recommendedAction === "NO_ACTION") {
        return fail("There is nothing to reject. Use Edit if you want to order something.");
      }
      return {
        ok: true,
        update: {
          decisionStatus: "rejected",
          finalAction: "NO_ACTION",
          finalQty: 0,
          overrideReason: input.reasonCategory,
          overrideNote: input.note,
        },
      };
    }

    case "edit":
    case "decide": {
      const order = isOrderAction(input.action);
      if (order && !(typeof input.qty === "number" && input.qty >= 1)) {
        return fail("Enter a quantity of at least 1 for an order.");
      }
      const qty = order ? (input.qty as number) : 0;
      if (input.decision === "edit" && input.action === item.recommendedAction && qty === (item.recommendedQty ?? 0)) {
        return fail("That matches the recommendation. Use Approve instead.");
      }
      return {
        ok: true,
        update: {
          decisionStatus: input.decision === "edit" ? "edited" : "approved",
          finalAction: input.action,
          finalQty: qty,
          overrideReason: input.reasonCategory,
          overrideNote: input.note,
        },
      };
    }
  }
}
