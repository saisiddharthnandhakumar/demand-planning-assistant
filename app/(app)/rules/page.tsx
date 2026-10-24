import type { Metadata } from "next";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { getRulesVersions } from "@/lib/db/queries";
import { rulesToInputValues } from "@/lib/rules-form";
import { buildTimeline } from "@/lib/rules-timeline";
import { formatWhen } from "./format-when";
import { RulesEditor } from "./rules-editor";
import { RulesHistory } from "./rules-history";

export const metadata: Metadata = { title: "Rules" };

export default async function RulesPage() {
  await connection(); // read the database on every request, never at build time
  const { current, all } = await getRulesVersions(getDb());

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-medium tracking-tight">Rules</h1>
        <p className="text-sm text-muted-foreground">
          The thresholds the engine applies. Edit them here, no deploy needed. Changes apply from the next run.
        </p>
      </div>
      <RulesEditor
        version={current.version}
        updatedBy={current.by}
        updatedAtLabel={formatWhen(current.at)}
        values={rulesToInputValues(current.document)}
      />
      <RulesHistory timeline={buildTimeline(all, current.version)} />
    </div>
  );
}
