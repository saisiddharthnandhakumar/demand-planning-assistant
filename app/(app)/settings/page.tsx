import type { Metadata } from "next";
import { connection } from "next/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auditLabel, summarizeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { listAuditLog } from "@/lib/db/dashboard";
import { getRuleSet, getSystemState } from "@/lib/db/queries";
import { KillSwitchCard } from "../kill-switch-card";
import { formatWhen } from "../rules/format-when";
import { ResumeForm } from "./resume-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await connection();
  const db = getDb();
  const [state, rules, audit] = await Promise.all([getSystemState(db), getRuleSet(db), listAuditLog(db, 40)]);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">The kill switch, how to resume it, and the audit trail. Thresholds are edited under Rules.</p>
      </div>

      <KillSwitchCard state={state} kill={rules.kill} />

      {state.paused ? (
        <ResumeForm />
      ) : (
        <p className="text-sm text-muted-foreground">The system is running. The resume form appears here if the kill switch pauses it.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Audit trail</CardTitle>
          <CardDescription>The most recent {audit.length} events: pauses, resumes, rule changes, runs and submissions.</CardDescription>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has been logged yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">When</TableHead>
                  <TableHead className="w-40">Who</TableHead>
                  <TableHead className="w-44">Event</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-normal align-top">{formatWhen(e.at)}</TableCell>
                    <TableCell className="whitespace-normal align-top">{e.actor}</TableCell>
                    <TableCell className="whitespace-normal align-top font-medium">{auditLabel(e.action)}</TableCell>
                    <TableCell className="whitespace-normal align-top text-sm text-muted-foreground">{summarizeAudit(e.action, e.detail)}</TableCell>
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
