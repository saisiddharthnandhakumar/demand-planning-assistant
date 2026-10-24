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
  const awaiting = stats.filter((s) => s.status === "open");
  const latest = points.at(-1);
  const draftCount = orders.filter((o) => o.status === "created").length;
  const previewCount = orders.filter((o) => o.status === "dry_run").length;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-medium tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">How the system is behaving, and whether it is paying off.</p>
      </div>

      <section aria-label="Key figures" className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-lg border bg-card lg:grid-cols-4 lg:divide-y-0">
        <Figure
          label="Awaiting your review"
          value={String(awaiting.length)}
          note={awaiting.length === 0 ? "Nothing open" : awaiting.length === 1 ? "Open run" : "Open runs"}
          href={awaiting[0] ? `/runs/${awaiting[0].id}` : "/runs"}
        />
        <Figure
          label="Last override rate"
          value={latest ? `${latest.rate.toFixed(1)}%` : "—"}
          note={latest ? `${latest.breach ? "Above" : "Within"} the ${Math.round(threshold * 1000) / 10}% limit` : "No submitted run yet"}
          tone={latest?.breach ? "bad" : undefined}
        />
        <Figure
          label="Kill switch"
          value={state.paused ? "Paused" : "Running"}
          note={`Streak ${state.consecutiveBreaches} of ${rules.kill.consecutive_runs}`}
          tone={state.paused ? "bad" : undefined}
        />
        <Figure
          label="Draft purchase orders"
          value={String(draftCount)}
          note={previewCount > 0 ? `${previewCount} preview${previewCount === 1 ? "" : "s"} only (dry-run)` : "In Zoho, not sent"}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
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
      <KillSwitchCard state={state} kill={rules.kill} showManageLink />
      </div>

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
                    <TableCell className="figure text-right">{r.stockout}</TableCell>
                    <TableCell className="figure text-right">{r.overstock}</TableCell>
                    <TableCell className="figure text-right">{r.highDemand}</TableCell>
                    <TableCell className="figure text-right">{r.noAction}</TableCell>
                    <TableCell className="figure text-right">{r.edge}</TableCell>
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
            <p className="text-sm text-muted-foreground">No purchase orders yet. They appear here when a run is submitted (as previews while Zoho is in dry-run mode).</p>
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
                      <Link href={`/runs/${o.runId}`} className="figure text-[13px] underline-offset-4 hover:underline">
                        {o.runId.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={o.status === "failed" ? "danger" : o.status === "pending" ? "warning" : o.status === "created" ? "success" : "neutral"}>
                        {o.status === "dry_run" ? "Preview only" : o.status === "created" ? "Draft created" : o.status === "pending" ? "Unclear: check Zoho" : "Failed"}
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

/** A key figure set as type, not a tile: label, one large number, one line saying what it is measured against. */
function Figure({ label, value, note, href, tone }: { label: string; value: string; note: string; href?: string; tone?: "bad" }) {
  const body = (
    <div className="flex h-full flex-col gap-1 p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`figure text-3xl font-medium tracking-tight ${tone === "bad" ? "text-[var(--negative)]" : ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-colors hover:bg-muted/50">
      {body}
    </Link>
  ) : (
    body
  );
}
