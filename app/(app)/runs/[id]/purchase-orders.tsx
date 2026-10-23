import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { listRunPurchaseOrders, planRunPurchaseOrders, type RunPo } from "@/lib/po/db";
import { readZohoRuntime } from "@/lib/zoho";
import { formatWhen } from "../../rules/format-when";
import { CreatePosButton, ReleaseButton } from "./po-buttons";

/**
 * The draft purchase orders for a submitted run. Prices are added by procurement
 * in Zoho; this app never issues or sends an order.
 */
export async function PurchaseOrders({ runId, paused }: { runId: string; paused: boolean }) {
  const db = getDb();
  const [orders, plan] = await Promise.all([listRunPurchaseOrders(db, runId), planRunPurchaseOrders(db, runId)]);
  const runtime = readZohoRuntime();
  const live = runtime.mode === "live";
  const plannedCount = plan?.orders.length ?? 0;
  const skipped = plan?.skipped ?? [];

  const needsAction = orders.length < plannedCount || orders.some((o) => o.status === "failed") || (live && orders.some((o) => o.status === "dry_run"));
  const buttonLabel = orders.length === 0 ? (live ? "Create draft purchase orders" : "Prepare purchase order previews") : live ? "Create or retry draft purchase orders" : "Refresh previews";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Draft purchase orders</CardTitle>
        <CardDescription>
          One draft per vendor from the approved lines. Procurement adds prices in Zoho and sends them; this app never issues or sends an order.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {live ? (
          <p className="text-xs text-muted-foreground">Mode: live. Orders are created as drafts in Zoho Inventory.</p>
        ) : (
          <Alert>
            <AlertTitle>Dry-run mode</AlertTitle>
            <AlertDescription>Nothing is sent to Zoho. Each order below is a preview of what would be created. Set ZOHO_MODE=live, with Zoho credentials and real vendor and item ids, to create drafts.</AlertDescription>
          </Alert>
        )}

        {paused && (
          <Alert variant="destructive">
            <AlertTitle>System paused</AlertTitle>
            <AlertDescription>Purchase orders are blocked while the system is paused. Resume it in Settings, then create them from this page.</AlertDescription>
          </Alert>
        )}

        {plannedCount === 0 && orders.length === 0 && skipped.length === 0 && <p className="text-sm text-muted-foreground">Nothing to order in this run: no approved line has an order quantity.</p>}

        {skipped.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Lines without a vendor</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {skipped.map((s) => (
                  <li key={s.skuId}>
                    {s.skuId} ({s.quantity} units): {s.reason}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {orders.map((o) => (
          <PoCard key={o.vendor} runId={runId} po={o} />
        ))}

        {needsAction && plannedCount > 0 && !paused && <CreatePosButton runId={runId} label={buttonLabel} />}
      </CardContent>
    </Card>
  );
}

const STATUS: Record<RunPo["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  dry_run: { label: "Would create this PO (preview)", variant: "outline" },
  created: { label: "Draft created in Zoho", variant: "secondary" },
  failed: { label: "Failed: nothing was created", variant: "destructive" },
  pending: { label: "Waiting: unclear answer from Zoho", variant: "destructive" },
};

function PoCard({ runId, po }: { runId: string; po: RunPo }) {
  const s = STATUS[po.status];
  const units = po.lines.reduce((n, l) => n + l.quantity, 0);
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-medium">{po.vendorName ?? po.vendor}</h3>
        <Badge variant={s.variant}>{s.label}</Badge>
        <span className="text-xs text-muted-foreground">
          {po.lines.length} line{po.lines.length === 1 ? "" : "s"} · {units.toLocaleString("en-IN")} units · {formatWhen(po.updatedAt)}
        </span>
      </div>

      {po.status === "created" && po.zohoPoUrl && (
        <p className="text-sm">
          <a href={po.zohoPoUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            Open in Zoho{po.zohoPoId ? ` (${po.zohoPoId})` : ""}
          </a>
        </p>
      )}
      {po.warning && (
        <Alert variant="destructive">
          <AlertTitle>Check this order in Zoho</AlertTitle>
          <AlertDescription>{po.warning}</AlertDescription>
        </Alert>
      )}
      {po.error && (po.status === "failed" || po.status === "pending") && (
        <p role="alert" className="text-sm text-destructive">
          {po.error}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Zoho item</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {po.lines.map((l) => (
            <TableRow key={l.skuId}>
              <TableCell className="whitespace-normal">
                <div className="font-medium">{l.skuId}</div>
                {l.skuName && <div className="text-xs text-muted-foreground">{l.skuName}</div>}
              </TableCell>
              <TableCell className="font-mono text-xs">{l.itemId}</TableCell>
              <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {po.status === "pending" && <ReleaseButton runId={runId} vendor={po.vendor} vendorName={po.vendorName ?? po.vendor} />}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">{po.status === "dry_run" ? "Show the exact request that would be sent" : "Show the request"}</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(po.payload, null, 2)}</pre>
      </details>
    </div>
  );
}
