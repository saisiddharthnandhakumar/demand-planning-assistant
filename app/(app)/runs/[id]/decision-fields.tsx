"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DECISION_ACTIONS,
  MAX_NOTE_LENGTH,
  REASON_CATEGORIES,
  isOrderAction,
  type DecisionAction,
  type DecisionInput,
} from "@/lib/decisions";
import { ACTION_LABEL } from "@/lib/engine/labels";

export type DecisionMode = "edit" | "reject" | "decide";

/**
 * The form for an Edit, a Reject, or an edge SKU's decision. For edge SKUs
 * nothing is prefilled: the planner chooses action, quantity and reason himself.
 */
export function DecisionFields({
  idPrefix,
  mode,
  initial,
  pending,
  error,
  fieldErrors,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  mode: DecisionMode;
  initial?: { action: DecisionAction | ""; qty: number | null; reason: string; note: string | null };
  pending: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
  onSubmit: (input: DecisionInput) => void;
  onCancel: () => void;
}) {
  const [action, setAction] = useState<DecisionAction | "">(initial?.action ?? "");
  const [qty, setQty] = useState(initial?.qty != null && initial.qty > 0 ? String(initial.qty) : "");
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [note, setNote] = useState(initial?.note ?? "");

  const showAction = mode !== "reject";
  const showQty = showAction && isOrderAction(action);

  function submit() {
    const base = { reasonCategory: reason as never, note: note || null };
    if (mode === "reject") return onSubmit({ decision: "reject", ...base });
    onSubmit({
      decision: mode,
      action: (action || undefined) as never,
      qty: qty.trim() === "" ? null : Number(qty),
      ...base,
    });
  }

  const label = mode === "reject" ? "Reject" : mode === "edit" ? "Save edit" : "Save decision";

  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
      <div className="flex flex-wrap items-start gap-3">
        {showAction && (
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-action`}>Action</Label>
            <NativeSelect
              id={`${idPrefix}-action`}
              value={action}
              onChange={(e) => setAction(e.target.value as DecisionAction | "")}
              aria-invalid={fieldErrors.action ? true : undefined}
              className="w-40"
            >
              <option value="">Choose…</option>
              {DECISION_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </NativeSelect>
            {fieldErrors.action && <p className="text-xs text-destructive">{fieldErrors.action}</p>}
          </div>
        )}
        {showQty && (
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-qty`}>Quantity (units)</Label>
            <Input
              id={`${idPrefix}-qty`}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              aria-invalid={fieldErrors.qty ? true : undefined}
              className="w-32"
            />
            {fieldErrors.qty && <p className="text-xs text-destructive">{fieldErrors.qty}</p>}
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-reason`}>Reason</Label>
          <NativeSelect
            id={`${idPrefix}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={fieldErrors.reasonCategory ? true : undefined}
            className="w-52"
          >
            <option value="">Choose…</option>
            {REASON_CATEGORIES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
          {fieldErrors.reasonCategory && <p className="text-xs text-destructive">{fieldErrors.reasonCategory}</p>}
        </div>
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor={`${idPrefix}-note`}>Note (optional)</Label>
          <Input id={`${idPrefix}-note`} value={note} maxLength={MAX_NOTE_LENGTH} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {error && !Object.keys(fieldErrors).length && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" variant={mode === "reject" ? "destructive" : "default"} disabled={pending} onClick={submit}>
          {pending ? "Saving…" : label}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
