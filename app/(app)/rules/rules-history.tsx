import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRuleValue, ruleLabel } from "@/lib/rules-form";
import type { TimelineEntry } from "@/lib/rules-timeline";
import { formatWhen } from "./format-when";

export function RulesHistory({ timeline }: { timeline: TimelineEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>Every version of the rules, who saved it and what changed.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Version</TableHead>
              <TableHead className="w-48">Saved</TableHead>
              <TableHead className="w-48">By</TableHead>
              <TableHead>Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {timeline.map((e) => (
              <TableRow key={e.version}>
                <TableCell>
                  <span className="font-medium">v{e.version}</span>{" "}
                  {e.isCurrent && <Badge variant="secondary">current</Badge>}
                </TableCell>
                <TableCell className="whitespace-normal">{formatWhen(e.at)}</TableCell>
                <TableCell className="whitespace-normal">{e.by}</TableCell>
                <TableCell className="whitespace-normal">
                  {e.changes === null ? (
                    <span className="text-muted-foreground">{e.version === 1 ? "Initial rules" : "Previous version not available"}</span>
                  ) : (
                    <ul className="space-y-0.5 text-sm">
                      {e.changes.map((c) => (
                        <li key={c.path}>
                          <span className="font-medium">{ruleLabel(c.path)}:</span> {formatRuleValue(c.path, c.from)} →{" "}
                          {formatRuleValue(c.path, c.to)}
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
