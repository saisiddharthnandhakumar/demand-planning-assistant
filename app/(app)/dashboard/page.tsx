import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { getLossBaselines, getRunStats, listPurchaseOrders } from "@/lib/db/dashboard";
import { getRuleSet, getSystemState } from "@/lib/db/queries";
import { verdictFor } from "@/lib/killswitch";
import { quarterOfDate, todayInIst } from "@/lib/money";
import { KillSwitchCard } from "../kill-switch-card";
import { formatWhen } from "../rules/format-when";
import { StatusBadge } from "../runs/status-badge";
import { MoneyCard } from "./money-card";
import { OverrideChart, type OverridePoint } from "./override-chart";

export const metadata: Metadata = { title: "Dashboard" };

const dayLabel = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export default async function DashboardPage() {
  await connection(); // read the database on every request, never at build time
  const db = getDb();
  const [state, rules, stats, orders, baselines] = await Promise.all([
    getSystemState(db),
    getRuleSet(db),
    getRunStats(db, 40),
    listPurchaseOrders(db, 20),
    getLossBaselines(db),
  ]);

  const threshold = rules.kill.override_rate_threshold;
  const points: OverridePoint[] = stats
    .filter((s) => s.status === "submitted" && s.submittedAt && s.engineTotal > 0)
    .sort((a, b) => a.submittedAt!.getTime() - b.submittedAt!.getTime())
    .slice(-12)
    .map((s) => {
      const rate = s.overridden / s.engineTotal;
      return {
        id: s.id,
        label: dayLabel.format(s.submittedAt!),
        rate: rate * 100,
        breach: verdictFor(rate, threshold) === "breach",
        overridden: s.overridden,
        engineTotal: s.engineTotal,
      };
    });
  const flagRuns = stats.filter((s) => s.items > 0).slice(0, 10);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">How the system is behaving, and whether it is paying off.</p>
      </div>

      <KillSwitchCard state={state} kill={rules.kill} showManageLink />

      <Card>
        <CardHeader>
          <CardTitle>Override rate per run</CardTitle>
          <CardDescription>
            How often the planner changed the engine’s decisions. The system pauses itself if it stays above the limit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {points.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submitted runs yet. The chart appears after the first run is submitted.</p>
          ) : (
            <OverrideChart points={points} limitPct={Math.round(threshold * 1000) / 10} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Flags per run</CardTitle>
          <CardDescription>How many SKUs each run flagged. A SKU can carry more than one flag.</CardDescription>
        </CardHeader>
        <CardContent>
          {flagRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Stockout risk</TableHead>
                  <TableHead className="text-right">Overstock risk</TableHead>
                  <TableHead className="text-right">High demand</TableHead>
                  <TableHead className="text-right">No action</TableHead>
                  <TableHead className="text-right">Needs judgment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flagRuns.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-normal">
                      <Link href={`/runs/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                        {formatWhen(r.startedAt)}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {r.trigger === "cron" ? "Scheduled" : "Manual"} · as of {r.asOfDate}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.stockout}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.overstock}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.highDemand}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.noAction}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.edge}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Draft purchase orders</CardTitle>
          <CardDescription>Created in Zoho Inventory as drafts after a run is submitted. Procurement adds prices and sends them; this app never does.</CardDescription>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No purchase orders yet. They appear here once the Zoho step is enabled and a run is submitted.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Zoho</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="whitespace-normal">{formatWhen(o.createdAt)}</TableCell>
                    <TableCell className="whitespace-normal">{o.vendorName ?? o.vendor}</TableCell>
                    <TableCell>
                      <Link href={`/runs/${o.runId}`} className="underline-offset-4 hover:underline">
                        {o.runId.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={o.status === "failed" ? "destructive" : o.status === "created" ? "secondary" : "outline"}>
                        {o.status === "dry_run" ? "Preview only" : o.status === "created" ? "Draft created" : "Failed"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {o.zohoPoUrl ? (
                        <a href={o.zohoPoUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                          {o.zohoPoId ?? "Open in Zoho"}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <MoneyCard current={quarterOfDate(todayInIst(new Date()))} baselines={baselines} />
    </div>
  );
}
