"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runNow, type RunNowState } from "./actions";

export function RunNowForm({
  pausedReason,
  paused,
  minDate,
}: {
  paused: boolean;
  pausedReason: string | null;
  minDate?: string;
}) {
  const [state, action, pending] = useActionState<RunNowState, FormData>(runNow, {});
  // Controlled so the date survives the form reset React 19 does after each action.
  const [asOf, setAsOf] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run now</CardTitle>
        <CardDescription>
          Runs the same pipeline as the twice-weekly cron (Mon and Thu, 09:00 IST) and opens the result for review. Nothing
          is ordered until a run is approved and submitted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {paused && (
          <Alert variant="destructive">
            <AlertTitle>System paused</AlertTitle>
            <AlertDescription>
              {pausedReason ? `${pausedReason.replace(/\.$/, "")}.` : "No reason recorded."} Running is disabled until the system is resumed.
            </AlertDescription>
          </Alert>
        )}
        <form action={action} className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="asOfDate">As-of date (optional)</Label>
            <Input
              id="asOfDate"
              name="asOfDate"
              type="date"
              min={minDate}
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              disabled={paused || pending}
              className="w-44"
            />
          </div>
          <Button type="submit" disabled={paused || pending}>
            {pending ? "Running…" : "Run now"}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Leave the date blank to use the latest inventory date. Set it to repeat a run for a specific date, for example for a demo (not earlier than the first inventory snapshot).
        </p>
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
