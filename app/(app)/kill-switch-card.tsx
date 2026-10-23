import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatWhen } from "./rules/format-when";

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** Kill-switch status: running or paused, the rule, the current streak, and (if paused) why. */
export function KillSwitchCard({
  state,
  kill,
  showManageLink = false,
}: {
  state: { paused: boolean; reason: string | null; since: Date | null; consecutiveBreaches: number; breachRunIds: string[] };
  kill: { override_rate_threshold: number; consecutive_runs: number };
  showManageLink?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          Kill switch
          <Badge variant={state.paused ? "destructive" : "secondary"}>{state.paused ? "Paused" : "Running"}</Badge>
        </CardTitle>
        <CardDescription>
          The system pauses itself when {kill.consecutive_runs} submitted run{kill.consecutive_runs === 1 ? "" : "s"} in a row have an
          override rate above {pct(kill.override_rate_threshold)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {state.paused ? (
          <>
            <p>
              <span className="font-medium">Why:</span> {state.reason ?? "No reason recorded."}
            </p>
            {state.since && (
              <p>
                <span className="font-medium">Since:</span> {formatWhen(state.since)}
              </p>
            )}
            {state.breachRunIds.length > 0 && (
              <p>
                <span className="font-medium">Runs involved:</span>{" "}
                {state.breachRunIds.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    <Link href={`/runs/${id}`} className="underline underline-offset-4">
                      {id.slice(0, 8)}
                    </Link>
                  </span>
                ))}
              </p>
            )}
            <p className="text-muted-foreground">Cron runs are skipped, Run now and submitting are disabled, and purchase orders are blocked.</p>
          </>
        ) : (
          <p>
            Current streak: <strong>{state.consecutiveBreaches}</strong> of {kill.consecutive_runs} breaching run
            {kill.consecutive_runs === 1 ? "" : "s"}.{" "}
            <span className="text-muted-foreground">A run at or below the limit resets it.</span>
          </p>
        )}
        {showManageLink && (
          <p>
            <Link href="/settings" className="underline underline-offset-4">
              {state.paused ? "Review and resume in Settings" : "Settings and audit trail"}
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
