import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isOrderAction } from "@/lib/decisions";
import { overrideRate, reviewProgress } from "@/lib/override-rate";
import type { RunItemView } from "@/lib/runs/view";
import { formatWhen } from "../../rules/format-when";

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Shown once a run is submitted and locked. */
export function SubmittedSummary({ items, submittedBy, submittedAt, killThreshold }: { items: RunItemView[]; submittedBy: string | null; submittedAt: Date | null; killThreshold: number }) {
  const p = reviewProgress(items);
  const rate = overrideRate(items);
  const orders = items.filter((i) => isOrderAction(i.finalAction) && (i.finalQty ?? 0) > 0);
  const units = orders.reduce((sum, i) => sum + (i.finalQty ?? 0), 0);
  const overridden = p.engineEdited + p.engineRejected;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run summary</CardTitle>
        <CardDescription>
          Submitted{submittedBy ? ` by ${submittedBy}` : ""}
          {submittedAt ? ` on ${formatWhen(submittedAt)}` : ""}. Decisions are locked.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs text-muted-foreground">Engine decisions</div>
          <div className="text-lg font-semibold">{p.engineTotal}</div>
          <div className="text-xs text-muted-foreground">
            {p.engineApproved} approved · {p.engineEdited} edited · {p.engineRejected} rejected
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Override rate</div>
          <div className="text-lg font-semibold">{rate === null ? "—" : pct1(rate)}</div>
          <div className="text-xs text-muted-foreground">
            {rate === null
              ? "No engine decisions in this run"
              : `${overridden} of ${p.engineTotal} · limit ${pct1(killThreshold)}${rate > killThreshold ? " (above)" : ""}`}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Lines to order</div>
          <div className="text-lg font-semibold">{orders.length}</div>
          <div className="text-xs text-muted-foreground">
            {units.toLocaleString("en-IN")} units in total, including {p.edgeTotal} judgment decision{p.edgeTotal === 1 ? "" : "s"}
          </div>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-3">
          Draft purchase orders in Zoho are created by a later step that is not enabled in this build yet.
        </p>
      </CardContent>
    </Card>
  );
}
