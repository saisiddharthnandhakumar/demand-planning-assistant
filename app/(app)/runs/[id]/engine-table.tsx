"use client";

import { Fragment, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { describeAction, FLAG_LABEL } from "@/lib/engine/labels";
import type { RunItemView } from "@/lib/runs/view";
import { bulkApproveAction, decideAction } from "./actions";
import { DecisionFields, type DecisionMode } from "./decision-fields";
import { ItemStatus } from "./item-status";
import { useRunAction } from "./use-run-action";

export function EngineTable({ runId, items, editable }: { runId: string; items: RunItemView[]; editable: boolean }) {
  const untouched = items.filter((i) => i.decisionStatus === "pending").length;
  return (
    <div className="space-y-4">
      {editable && <BulkApprove runId={runId} untouched={untouched} />}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead className="text-right">Cover (wk)</TableHead>
            <TableHead>Recommended</TableHead>
            <TableHead>Status</TableHead>
            {editable && <TableHead className="text-right">Decision</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <EngineRow key={item.skuId} runId={runId} item={item} editable={editable} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EngineRow({ runId, item, editable }: { runId: string; item: RunItemView; editable: boolean }) {
  const [mode, setMode] = useState<Exclude<DecisionMode, "decide"> | null>(null);
  const act = useRunAction();
  const decided = item.decisionStatus !== "pending";

  const open = (m: Exclude<DecisionMode, "decide">) => {
    act.reset();
    setMode(m);
  };
  const decide = (input: Parameters<typeof decideAction>[2]) =>
    act.run(() => decideAction(runId, item.skuId, input), () => setMode(null));

  return (
    <Fragment>
      <TableRow>
        <TableCell className="whitespace-normal align-top">
          <div className="font-medium">{item.skuId}</div>
          <div className="text-xs text-muted-foreground">{item.skuName}</div>
        </TableCell>
        <TableCell className="whitespace-normal align-top">
          <div className="flex flex-wrap gap-1">
            {item.flags.length === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              item.flags.map((f) => (
                <Badge key={f} variant={f === "HIGH_DEMAND" ? "secondary" : "outline"}>
                  {FLAG_LABEL[f]}
                </Badge>
              ))
            )}
          </div>
        </TableCell>
        <TableCell className="text-right align-top tabular-nums">{item.coverWeeks?.toFixed(2) ?? "—"}</TableCell>
        <TableCell className="max-w-sm whitespace-normal align-top">
          <div className="font-medium">{describeAction(item.recommendedAction, item.recommendedQty)}</div>
          <div className="text-xs text-muted-foreground">{item.reason}</div>
        </TableCell>
        <TableCell className="whitespace-normal align-top">
          <ItemStatus item={item} />
        </TableCell>
        {editable && (
          <TableCell className="whitespace-normal align-top">
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button
                size="sm"
                variant={item.decisionStatus === "approved" ? "secondary" : "default"}
                disabled={act.pending || item.decisionStatus === "approved"}
                aria-label={`Approve ${item.skuId}`}
                onClick={() => decide({ decision: "approve" })}
              >
                Approve
              </Button>
              <Button size="sm" variant="outline" disabled={act.pending} aria-label={`Edit ${item.skuId}`} onClick={() => open("edit")}>
                Edit
              </Button>
              {item.recommendedAction !== "NO_ACTION" && (
                <Button size="sm" variant="outline" disabled={act.pending} aria-label={`Reject ${item.skuId}`} onClick={() => open("reject")}>
                  Reject
                </Button>
              )}
              {decided && (
                <Button size="sm" variant="ghost" disabled={act.pending} aria-label={`Undo decision for ${item.skuId}`} onClick={() => decide({ decision: "clear" })}>
                  Undo
                </Button>
              )}
            </div>
            {act.error && mode === null && (
              <p role="alert" className="mt-1 text-right text-xs text-destructive">
                {act.error}
              </p>
            )}
          </TableCell>
        )}
      </TableRow>
      {editable && mode && (
        <TableRow>
          <TableCell colSpan={6} className="whitespace-normal bg-background">
            <DecisionFields
              idPrefix={`${item.skuId}-${mode}`}
              mode={mode}
              initial={{
                action: item.finalAction ?? item.recommendedAction,
                qty: item.finalQty ?? item.recommendedQty,
                reason: item.overrideReason ?? "",
                note: item.overrideNote,
              }}
              pending={act.pending}
              error={act.error}
              fieldErrors={act.fieldErrors}
              onSubmit={decide}
              onCancel={() => setMode(null)}
            />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

/** "Approve all untouched engine decisions", with the count shown and confirmed first. */
function BulkApprove({ runId, untouched }: { runId: string; untouched: number }) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const act = useRunAction();

  if (untouched === 0 && !done) {
    return <p className="text-sm text-muted-foreground">Every engine decision has been decided.</p>;
  }
  return (
    <div className="space-y-2">
      {!confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={untouched === 0}
            onClick={() => {
              act.reset();
              setDone(null);
              setConfirming(true);
            }}
          >
            Approve all untouched engine decisions ({untouched})
          </Button>
          <span className="text-xs text-muted-foreground">Decisions you have already approved, edited or rejected are left alone.</span>
        </div>
      ) : (
        <Alert>
          <AlertDescription className="space-y-3">
            <p>
              <strong>
                Approve {untouched} untouched engine decision{untouched === 1 ? "" : "s"}?
              </strong>{" "}
              Each is approved exactly as recommended. SKUs that need your judgment are not included.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={act.pending}
                onClick={() =>
                  act.run(
                    () => bulkApproveAction(runId, untouched),
                    (m) => {
                      setConfirming(false);
                      setDone(m ?? "Approved.");
                    },
                  )
                }
              >
                {act.pending ? "Approving…" : `Confirm: approve ${untouched}`}
              </Button>
              <Button size="sm" variant="ghost" disabled={act.pending} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
            {act.error && (
              <p role="alert" className="text-sm text-destructive">
                {act.error}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}
      {done && <p className="text-sm text-muted-foreground">{done}</p>}
    </div>
  );
}
