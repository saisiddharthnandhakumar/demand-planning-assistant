import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getDb } from "@/lib/db";
import { getRuleSet, getRunDetail, getSystemState } from "@/lib/db/queries";
import { toItemView } from "@/lib/runs/view";
import { formatWhen } from "../../rules/format-when";
import { StatusBadge } from "../status-badge";
import { ReviewPanel } from "./review-panel";
import { SubmittedSummary } from "./submitted-summary";

export const metadata: Metadata = { title: "Run" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = getDb();
  const [detail, state, current] = await Promise.all([getRunDetail(db, id), getSystemState(db), getRuleSet(db)]);
  if (!detail) notFound();
  const { run, items } = detail;
  const views = items.map(toItemView);
  // The windows the run was computed with; the kill limit is whatever is current.
  const recentWeeks = (run.rulesSnapshot as { surge_recent_weeks?: number } | null)?.surge_recent_weeks ?? current.surge_recent_weeks;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href="/runs" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← All runs
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Run {run.id.slice(0, 8)}</h1>
          <StatusBadge status={run.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          Started {formatWhen(run.startedAt)} by {run.trigger === "cron" ? "the schedule" : "a manual run"}
          {run.asOfDate && <> · as of {run.asOfDate}</>}
          {run.rulesVersion && <> · rules v{run.rulesVersion}</>}
        </p>
      </div>

      {(run.skipReason || run.error) && (
        <Alert variant={run.status === "failed" ? "destructive" : "default"}>
          <AlertTitle>{run.status === "failed" ? "This run failed" : "This run was skipped"}</AlertTitle>
          <AlertDescription>{run.skipReason ?? run.error}</AlertDescription>
        </Alert>
      )}

      {run.status === "submitted" && (
        <SubmittedSummary items={views} submittedBy={run.submittedBy} submittedAt={run.submittedAt} killThreshold={current.kill.override_rate_threshold} />
      )}

      {views.length > 0 && (
        <ReviewPanel
          runId={run.id}
          items={views}
          editable={run.status === "open"}
          killThreshold={current.kill.override_rate_threshold}
          recentWeeks={recentWeeks}
          paused={state.paused}
          pausedReason={state.reason}
        />
      )}
    </div>
  );
}
