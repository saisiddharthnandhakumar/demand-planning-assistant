"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { saveLossAction, type LossResult } from "./actions";

export interface QuarterOption {
  key: string;
  label: string;
  stockout: string;
  writeoff: string;
}

/** Enter or update a quarter's stockout loss and overstock write-off, in whole rupees. */
export function LossForm({ options, defaultQuarter }: { options: QuarterOption[]; defaultQuarter: string }) {
  const [quarter, setQuarter] = useState(defaultQuarter);
  const [stockout, setStockout] = useState(options.find((o) => o.key === defaultQuarter)?.stockout ?? "");
  const [writeoff, setWriteoff] = useState(options.find((o) => o.key === defaultQuarter)?.writeoff ?? "");
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LossResult | null>(null);
  const fieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {};

  function chooseQuarter(key: string) {
    setQuarter(key);
    const existing = options.find((o) => o.key === key);
    setStockout(existing?.stockout ?? "");
    setWriteoff(existing?.writeoff ?? "");
    setResult(null);
  }

  function submit() {
    startTransition(async () => setResult(await saveLossAction({ quarter, stockout, writeoff, name })));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="loss-quarter">Quarter</Label>
          <NativeSelect id="loss-quarter" value={quarter} onChange={(e) => chooseQuarter(e.target.value)} className="w-48">
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label} ({o.key})
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loss-stockout">Stockout loss (₹)</Label>
          <Input id="loss-stockout" inputMode="numeric" value={stockout} onChange={(e) => setStockout(e.target.value)} aria-invalid={fieldErrors.stockout ? true : undefined} className="w-44" placeholder="e.g. 20,00,000" />
          {fieldErrors.stockout && <p className="max-w-44 text-xs text-destructive">{fieldErrors.stockout}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loss-writeoff">Overstock write-off (₹)</Label>
          <Input id="loss-writeoff" inputMode="numeric" value={writeoff} onChange={(e) => setWriteoff(e.target.value)} aria-invalid={fieldErrors.writeoff ? true : undefined} className="w-44" placeholder="e.g. 11,00,000" />
          {fieldErrors.writeoff && <p className="max-w-44 text-xs text-destructive">{fieldErrors.writeoff}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loss-name">Your name</Label>
          <Input id="loss-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-invalid={fieldErrors.name ? true : undefined} className="w-44" />
          {fieldErrors.name && <p className="max-w-44 text-xs text-destructive">{fieldErrors.name}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save quarter"}
        </Button>
        {result?.ok && <p className="text-sm text-muted-foreground">{result.message}</p>}
        {result && !result.ok && !Object.keys(fieldErrors).length && (
          <p role="alert" className="text-sm text-destructive">
            {result.error}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Whole rupees. Commas are fine (1 lakh = 1,00,000). Saving a quarter that already has figures replaces them, and every change is logged.</p>
    </div>
  );
}
