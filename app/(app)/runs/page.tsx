import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { getInventoryDateRange, getSystemState, listRuns } from "@/lib/db/queries";
import { formatWhen } from "../rules/format-when";
import { RunNowForm } from "./run-now-form";
import { StatusBadge } from "./status-badge";

export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage() {
  await connection(); // read the database on every request, never at build time
  const db = getDb();
  const [state, runs, range] = await Promise.all([getSystemState(db), listRuns(db), getInventoryDateRange(db)]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-medium tracking-tight">Runs</h1>
        <p className="text-sm text-muted-foreground">
          Each run applies the current rules to the latest data and waits here for review.
        </p>
      </div>

      <RunNowForm paused={state.paused} pausedReason={state.reason} minDate={range?.first} />

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>Most recent first.</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet. Use Run now, or wait for the next scheduled run.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>As of</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">SKUs</TableHead>
                  <TableHead className="text-right">Needs judgment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-normal">
                      <Link href={`/runs/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                        {formatWhen(r.startedAt)}
                      </Link>
                      {(r.skipReason || r.error) && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{r.skipReason ?? r.error}</div>
                      )}
                    </TableCell>
                    <TableCell className="capitalize">{r.trigger}</TableCell>
                    <TableCell className="figure text-[13px]">{r.asOfDate ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="figure text-right">{r.items || "—"}</TableCell>
                    <TableCell className="figure text-right">{r.items ? r.edge : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
