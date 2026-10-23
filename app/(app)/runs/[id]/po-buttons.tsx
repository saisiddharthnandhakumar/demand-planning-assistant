"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPosAction, releasePoAction } from "./actions";
import { useRunAction } from "./use-run-action";

/** Creates (or, in dry-run, previews) the purchase orders. Safe to press repeatedly: existing orders are never duplicated. */
export function CreatePosButton({ runId, label }: { runId: string; label: string }) {
  const act = useRunAction();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        disabled={act.pending}
        onClick={() => {
          setMessage(null);
          act.run(() => createPosAction(runId), (m) => setMessage(m ?? null));
        }}
      >
        {act.pending ? "Working…" : label}
      </Button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {act.error && (
        <p role="alert" className="text-sm text-destructive">
          {act.error}
        </p>
      )}
    </div>
  );
}

/** For an order whose outcome was unclear: after checking Zoho by hand, allow it to be retried. */
export function ReleaseButton({ runId, vendor, vendorName }: { runId: string; vendor: string; vendorName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const act = useRunAction();
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        I checked Zoho: there is no order
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <p className="text-sm">
        Only continue if you searched Zoho for a purchase order for <strong>{vendorName}</strong> with this run’s id as its reference and found <strong>none</strong>. If one exists, creating another would duplicate it.
      </p>
      <div className="space-y-1">
        <Label htmlFor={`release-${vendor}`}>Your name</Label>
        <Input id={`release-${vendor}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="max-w-xs" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={act.pending || name.trim() === ""} onClick={() => act.run(() => releasePoAction(runId, vendor, name), () => setOpen(false))}>
          {act.pending ? "Releasing…" : "Allow retry"}
        </Button>
        <Button size="sm" variant="ghost" disabled={act.pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {act.error && (
        <p role="alert" className="text-sm text-destructive">
          {act.error}
        </p>
      )}
    </div>
  );
}
