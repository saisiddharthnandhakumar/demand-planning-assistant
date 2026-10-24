import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ENTRY_QUARTER_COUNT,
  compareLoss,
  formatInr,
  formatLakh,
  previousQuarter,
  quarterKey,
  quarterLabel,
  recentQuarters,
  totalLoss,
  type Quarter,
  type QuarterLoss,
} from "@/lib/money";
import { LossForm, type QuarterOption } from "./loss-form";

interface Baseline extends QuarterLoss {
  quarter: string;
}

/**
 * The money card is entered by hand. "Rs vs last quarter" = last quarter's total
 * loss minus this quarter's total loss. The case brief only gives a range for
 * the baseline, so nothing is assumed: until both quarters are entered the card
 * says what is missing.
 */
export function MoneyCard({ current, baselines }: { current: Quarter; baselines: Baseline[] }) {
  const last = previousQuarter(current);
  const byKey = new Map(baselines.map((b) => [b.quarter, b]));
  const lastLoss = byKey.get(quarterKey(last));
  const thisLoss = byKey.get(quarterKey(current));
  const comparison = compareLoss(lastLoss, thisLoss);

  const options: QuarterOption[] = recentQuarters(current, ENTRY_QUARTER_COUNT).map((q) => {
    const b = byKey.get(quarterKey(q));
    return {
      key: quarterKey(q),
      label: quarterLabel(q),
      stockout: b ? String(b.stockoutLossInr) : "",
      writeoff: b ? String(b.writeoffLossInr) : "",
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Money: rupee loss vs last quarter</CardTitle>
        <CardDescription>
          Entered by hand. The case brief gives only a range for a typical quarter (stockouts about ₹18–22 lakh, overstock write-offs about ₹10–12 lakh, ₹28–34 lakh in total), so enter last quarter’s actual figures as the baseline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <QuarterBlock title="Last quarter" quarter={last} loss={lastLoss} />
          <QuarterBlock title="This quarter" quarter={current} loss={thisLoss} />
          <div>
            <div className="text-xs text-muted-foreground">Rs vs last quarter</div>
            {comparison.status === "ok" ? (
              <>
                <div className="figure text-2xl font-medium">
                  {comparison.diff > 0 ? "+" : comparison.diff < 0 ? "−" : ""}
                  {formatInr(Math.abs(comparison.diff))}
                </div>
                <div className="text-xs text-muted-foreground">
                  {comparison.direction === "better" && `Less loss than last quarter (${formatLakh(comparison.diff)} lower)`}
                  {comparison.direction === "worse" && `More loss than last quarter (${formatLakh(comparison.diff)} higher)`}
                  {comparison.direction === "same" && "Same loss as last quarter"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">= {formatInr(comparison.lastTotal)} − {formatInr(comparison.thisTotal)}</div>
              </>
            ) : (
              <>
                <div className="text-2xl font-medium text-muted-foreground">—</div>
                <div className="text-xs text-muted-foreground">
                  Enter {comparison.missing.map((m) => (m === "last" ? `last quarter (${quarterLabel(last)})` : `this quarter (${quarterLabel(current)})`)).join(" and ")} to compare.
                </div>
              </>
            )}
          </div>
        </div>
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Note: Oct–Dec contains festival months (October and November), so comparing it with the quarter before is seasonal, not like for like. Quarters here are calendar quarters (Oct–Dec is Q4).
        </p>
        <div className="border-t pt-4">
          <h3 className="mb-3 text-sm font-medium">Enter or update a quarter</h3>
          <LossForm options={options} defaultQuarter={quarterKey(last)} />
        </div>
      </CardContent>
    </Card>
  );
}

function QuarterBlock({ title, quarter, loss }: { title: string; quarter: Quarter; loss: QuarterLoss | undefined }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">
        {title} · {quarterLabel(quarter)}
      </div>
      {loss ? (
        <>
          <div className="figure text-2xl font-medium">{formatInr(totalLoss(loss))}</div>
          <div className="text-xs text-muted-foreground">
            Stockouts {formatInr(loss.stockoutLossInr)} · write-offs {formatInr(loss.writeoffLossInr)}
          </div>
        </>
      ) : (
        <>
          <div className="text-2xl font-medium text-muted-foreground">Not entered</div>
          <div className="text-xs text-muted-foreground">Use the form below.</div>
        </>
      )}
    </div>
  );
}
