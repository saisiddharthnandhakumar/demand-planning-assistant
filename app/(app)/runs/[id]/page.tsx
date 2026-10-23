import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { getRunDetail } from "@/lib/db/queries";
import { describeAction, FLAG_LABEL } from "@/lib/engine/labels";
import type { Action, Flag } from "@/lib/engine/types";
import { formatWhen } from "../../rules/format-when";
import { StatusBadge } from "../status-badge";

export const metadata: Metadata = { title: "Run" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await getRunDetail(getDb(), id);
  if (!detail) notFound();
  const { run, items } = detail;

  const engine = items.filter((i) => !i.item.isEdge);
  const edge = items.filter((i) => i.item.isEdge);

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

      {items.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Engine decisions</CardTitle>
              <CardDescription>
                {engine.length} SKUs the rules can decide. Review and approval arrive in the next milestone; this page is
                read-only for now.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead className="text-right">Cover (weeks)</TableHead>
                    <TableHead>Recommended</TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {engine.map(({ item, skuName }) => (
                    <TableRow key={item.skuId}>
                      <TableCell className="whitespace-normal">
                        <div className="font-medium">{item.skuId}</div>
                        <div className="text-xs text-muted-foreground">{skuName}</div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-wrap gap-1">
                          {item.flags.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            item.flags.map((f) => (
                              <Badge key={f} variant={f === "HIGH_DEMAND" ? "secondary" : "outline"}>
                                {FLAG_LABEL[f as Flag]}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{item.metrics.coverWeeks?.toFixed(2) ?? "—"}</TableCell>
                      <TableCell className="font-medium">
                        {describeAction(item.recommendedAction as Action, item.recommendedQty ?? 0)}
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">{item.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Needs your judgment</CardTitle>
              <CardDescription>
                {edge.length === 0
                  ? "No SKUs were routed to you in this run."
                  : `${edge.length} SKU${edge.length === 1 ? " was" : "s were"} routed to you instead of getting a recommendation. You choose the action and quantity.`}
              </CardDescription>
            </CardHeader>
            {edge.length > 0 && (
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Why it was routed</TableHead>
                      <TableHead>For reference only</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {edge.map(({ item, skuName }) => (
                      <TableRow key={item.skuId}>
                        <TableCell className="whitespace-normal">
                          <div className="font-medium">{item.skuId}</div>
                          <div className="text-xs text-muted-foreground">{skuName}</div>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <ul className="space-y-1 text-sm">
                            {item.edgeReasons.map((r) => (
                              <li key={r.code}>{r.message}</li>
                            ))}
                          </ul>
                        </TableCell>
                        <TableCell className="max-w-xs whitespace-normal text-sm">
                          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            What the rules would have said
                          </div>
                          <div>{describeAction(item.recommendedAction as Action, item.recommendedQty ?? 0)}</div>
                          <div className="text-xs text-muted-foreground">Not a recommendation.</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
