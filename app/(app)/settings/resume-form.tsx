"use client";

import { useState, useTransition } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MIN_RESUME_REASON_LENGTH, RESUME_CONFIRMATION } from "@/lib/killswitch";
import { resumeAction } from "./actions";
import type { ResumeResult } from "@/lib/runs/resume-db";

/** Resuming needs a typed confirmation and a written reason; both go to the audit log. */
export function ResumeForm() {
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [actor, setActor] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ResumeResult | null>(null);
  const fieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resume the system</CardTitle>
        <CardDescription>
          Resuming turns scheduled runs, Run now, submitting and purchase orders back on, and resets the breach counter. Review the overrides that caused the pause first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="resume-reason">Why is it safe to resume?</Label>
          <Textarea
            id="resume-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            aria-invalid={fieldErrors.reason ? true : undefined}
            placeholder={`At least ${MIN_RESUME_REASON_LENGTH} characters. What did you review or change?`}
          />
          {fieldErrors.reason && <p className="text-xs text-destructive">{fieldErrors.reason}</p>}
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="resume-confirmation">
              Type <code className="rounded bg-muted px-1">{RESUME_CONFIRMATION}</code> to confirm
            </Label>
            <Input id="resume-confirmation" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" aria-invalid={fieldErrors.confirmation ? true : undefined} className="w-44" />
            {fieldErrors.confirmation && <p className="max-w-52 text-xs text-destructive">{fieldErrors.confirmation}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resume-actor">Your name</Label>
            <Input id="resume-actor" value={actor} maxLength={80} onChange={(e) => setActor(e.target.value)} aria-invalid={fieldErrors.actor ? true : undefined} className="w-44" />
            {fieldErrors.actor && <p className="max-w-44 text-xs text-destructive">{fieldErrors.actor}</p>}
          </div>
        </div>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() => startTransition(async () => setResult(await resumeAction({ confirmation, reason, actor })))}
        >
          {pending ? "Resuming…" : "Resume system"}
        </Button>
        {result && !result.ok && !Object.keys(fieldErrors).length && (
          <Alert variant="destructive">
            <AlertTitle>Not resumed</AlertTitle>
            <AlertDescription>{result.error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
