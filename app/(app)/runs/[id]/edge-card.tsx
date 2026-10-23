"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { describeAction } from "@/lib/engine/labels";
import type { RunItemView } from "@/lib/runs/view";
import { decideAction } from "./actions";
import { DecisionFields } from "./decision-fields";
import { ItemStatus } from "./item-status";
import { SalesChart } from "./sales-chart";
import { useRunAction } from "./use-run-action";

const fmt = (n: number | null, dp = 1) => (n === null ? "—" : n.toFixed(dp));

/**
 * One SKU routed to the planner. It shows why, the sales history and metrics,
 * and the rules' answer ONLY as a clearly labelled reference. There is no
 * recommended quantity, and the decision form starts empty.
 */
export function EdgeCard({ runId, item, editable, recentWeeks }: { runId: string; item: RunItemView; editable: boolean; recentWeeks: number }) {
  const [editing, setEditing] = useState(false);
  const act = useRunAction();
  const decided = item.decisionStatus !== "pending";
  const showForm = editable && (!decided || editing);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {item.skuId} <span className="font-normal text-muted-foreground">{item.skuName}</span>
          <Badge variant="outline">{item.category}</Badge>
          {item.perishability === "High" && <Badge variant="secondary">Perishable</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-6 md:grid-cols-[auto_1fr]">
          <SalesChart skuId={item.skuId} weeks={item.windowWeeks} series={item.series} recentWeeks={recentWeeks} baselineAvg={item.avg12} />
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Why it was routed to you</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {item.edgeReasons.map((r) => (
                  <li key={r.code}>{r.message}</li>
                ))}
              </ul>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <Metric label={`Last ${recentWeeks} wk avg`} value={fmt(item.avg4)} />
              <Metric label="Prior wk avg" value={fmt(item.prior8)} />
              <Metric label="Baseline avg" value={fmt(item.avg12)} />
              <Metric label="Cover (weeks)" value={`${fmt(item.coverWeeks, 2)} (min ${item.minWeeks})`} />
            </dl>
            <div className="rounded-lg border border-dashed p-3 text-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">For reference only: what the rules would have said</div>
              <div className="mt-0.5 font-medium">{describeAction(item.recommendedAction, item.recommendedQty)}</div>
              <div className="text-xs text-muted-foreground">
                Not a recommendation. Standard reorder quantity for this SKU is {item.standardReorderQty}. {item.reason}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">Your decision</h3>
          {decided && !showForm && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ItemStatus item={item} />
              {editable && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" aria-label={`Change decision for ${item.skuId}`} onClick={() => { act.reset(); setEditing(true); }}>
                    Change
                  </Button>
                  <Button size="sm" variant="ghost" disabled={act.pending} aria-label={`Undo decision for ${item.skuId}`} onClick={() => act.run(() => decideAction(runId, item.skuId, { decision: "clear" }))}>
                    Undo
                  </Button>
                </div>
              )}
            </div>
          )}
          {!decided && !editable && <p className="text-sm text-muted-foreground">No decision was recorded.</p>}
          {showForm && (
            <DecisionFields
              idPrefix={`${item.skuId}-decide`}
              mode="decide"
              initial={decided ? { action: item.finalAction ?? "", qty: item.finalQty, reason: item.overrideReason ?? "", note: item.overrideNote } : undefined}
              pending={act.pending}
              error={act.error}
              fieldErrors={act.fieldErrors}
              onSubmit={(input) => act.run(() => decideAction(runId, item.skuId, input), () => setEditing(false))}
              onCancel={() => setEditing(false)}
            />
          )}
          {act.error && !showForm && (
            <p role="alert" className="text-sm text-destructive">
              {act.error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
