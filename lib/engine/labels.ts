import type { Action, Flag } from "./types";

export const ACTION_LABEL: Record<Action, string> = {
  REORDER_NOW: "Reorder now",
  REORDER: "Reorder",
  PAUSE_ORDER: "Pause order",
  NO_ACTION: "No action",
};

export const FLAG_LABEL: Record<Flag, string> = {
  HIGH_DEMAND: "High demand",
  STOCKOUT_RISK: "Stockout risk",
  OVERSTOCK_RISK: "Overstock risk",
};

/** "Reorder now 750" or "No action". */
export function describeAction(action: Action, qty: number): string {
  return `${ACTION_LABEL[action]}${qty > 0 ? ` ${qty}` : ""}`;
}
