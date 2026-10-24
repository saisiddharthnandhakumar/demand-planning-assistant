import { Badge } from "@/components/ui/badge";
import { reasonLabel, type DecisionStatus } from "@/lib/decisions";
import { describeAction } from "@/lib/engine/labels";
import type { RunItemView } from "@/lib/runs/view";

const LABEL: Record<DecisionStatus, string> = {
  pending: "Not decided",
  approved: "Approved",
  edited: "Edited",
  rejected: "Rejected",
};

const VARIANT: Record<DecisionStatus, "neutral" | "success" | "info" | "danger"> = {
  pending: "neutral",
  approved: "success",
  edited: "info",
  rejected: "danger",
};

/** Status badge plus, for anything decided, what was finally decided and why. */
export function ItemStatus({ item }: { item: RunItemView }) {
  const label = item.isEdge && item.decisionStatus === "approved" ? "Decided" : LABEL[item.decisionStatus];
  const decided = item.decisionStatus !== "pending" && item.finalAction;
  return (
    <div className="space-y-1">
      <Badge variant={VARIANT[item.decisionStatus]}>{label}</Badge>
      {decided && (item.decisionStatus !== "approved" || item.isEdge) && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{describeAction(item.finalAction!, item.finalQty ?? 0)}</span>
          {item.overrideReason && <> · {reasonLabel(item.overrideReason)}</>}
          {item.overrideNote && <> · “{item.overrideNote}”</>}
        </div>
      )}
    </div>
  );
}
