"use client";

import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { breachWarning, formatPct } from "@/lib/killswitch";
import { overrideRate, reviewProgress, submitBlocker } from "@/lib/override-rate";
import type { RunItemView } from "@/lib/runs/view";
import { submitAction } from "./actions";
import { useRunAction } from "./use-run-action";

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;

export function SubmitPanel({
  runId,
  items,
  killThreshold,
  killRuns,
  killStreak,
  pausedReason,
  paused,
}: {
  runId: string;
  items: RunItemView[];
  killThreshold: number;
  killRuns: number;
  killStreak: number;
  paused: boolean;
  pausedReason: string | null;
}) {
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const act = useRunAction();

  const progress = reviewProgress(items);
  const blocker = submitBlocker(progress);
  const rate = overrideRate(items);
  const overridden = progress.engineEdited + progress.engineRejected;
  const nameMissing = name.trim() === "";
  const warning = progress.pendingEngine === 0 ? breachWarning({ rate, threshold: killThreshold, consecutiveRuns: killRuns, currentStreak: killStreak }) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit this run</CardTitle>
        <CardDescription>
          Submitting records every decision and locks the run. Nothing is ordered until you submit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <li>
            Engine decisions: <strong>{progress.engineDecided}</strong> of {progress.engineTotal} decided ({progress.engineApproved} approved, {progress.engineEdited} edited, {progress.engineRejected} rejected)
          </li>
          <li>
            Needs your judgment: <strong>{progress.edgeDecided}</strong> of {progress.edgeTotal} decided
          </li>
        </ul>

        {rate !== null && progress.pendingEngine === 0 && (
          <p className="text-sm">
            Override rate for this run: <strong>{pct1(rate)}</strong> ({overridden} of {progress.engineTotal} engine decisions edited or rejected).
          </p>
        )}
        {warning && (
          <Alert variant="destructive">
            <AlertTitle>Above the kill-switch limit ({formatPct(killThreshold)})</AlertTitle>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        )}

        {paused && (
          <Alert variant="destructive">
            <AlertTitle>System paused</AlertTitle>
            <AlertDescription>{pausedReason ? `${pausedReason.replace(/\.$/, "")}. ` : ""}Submitting is disabled until the system is resumed, because it creates purchase orders.</AlertDescription>
          </Alert>
        )}
        {blocker && <p className="text-sm text-muted-foreground">{blocker}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="submit-name">Your name</Label>
          <Input
            id="submit-name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={act.fieldErrors.name ? true : undefined}
            className="max-w-xs"
          />
          {act.fieldErrors.name && <p className="text-xs text-destructive">{act.fieldErrors.name}</p>}
        </div>

        {!confirming ? (
          <Button
            disabled={!progress.readyToSubmit || nameMissing || paused}
            onClick={() => {
              act.reset();
              setConfirming(true);
            }}
          >
            Submit run…
          </Button>
        ) : (
          <Alert>
            <AlertDescription className="space-y-3">
              <p>
                <strong>Submit and lock this run?</strong> You will not be able to change any decision afterwards.
              </p>
              <div className="flex gap-2">
                <Button size="sm" disabled={act.pending} onClick={() => act.run(() => submitAction(runId, name), () => setConfirming(false))}>
                  {act.pending ? "Submitting…" : "Confirm and submit"}
                </Button>
                <Button size="sm" variant="ghost" disabled={act.pending} onClick={() => setConfirming(false)}>
                  Back
                </Button>
              </div>
              {act.error && !act.fieldErrors.name && (
                <p role="alert" className="text-sm text-destructive">
                  {act.error}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
