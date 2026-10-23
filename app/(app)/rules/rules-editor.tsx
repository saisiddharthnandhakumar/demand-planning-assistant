"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DecisionSummary } from "@/lib/engine/compare";
import { RULE_GROUPS, formatRuleValue, ruleLabel } from "@/lib/rules-form";
import {
  previewRules,
  saveRulesAction,
  type PreviewState,
  type SaveState,
} from "./actions";

const ACTION_LABEL: Record<DecisionSummary["action"], string> = {
  REORDER_NOW: "Reorder now",
  REORDER: "Reorder",
  PAUSE_ORDER: "Pause order",
  NO_ACTION: "No action",
};

function describe(d: DecisionSummary) {
  const text = `${ACTION_LABEL[d.action]}${d.qty > 0 ? ` ${d.qty}` : ""}`;
  return d.isEdge ? `Needs your judgment (rules would say: ${text.toLowerCase()})` : text;
}

export function RulesEditor({
  version,
  updatedBy,
  updatedAtLabel,
  values,
}: {
  version: number;
  updatedBy: string;
  updatedAtLabel: string;
  values: Record<string, string>;
}) {
  const [save, saveAction, saving] = useActionState<SaveState, FormData>(saveRulesAction, { status: "idle" });
  const [preview, previewAction, previewing] = useActionState<PreviewState, FormData>(previewRules, {
    status: "idle",
  });
  const errors = { ...preview.errors, ...save.errors };
  // Controlled inputs: React resets uncontrolled form fields after every action,
  // which would wipe the user's edits after a preview or a failed save.
  const [fields, setFields] = useState(values);
  const [name, setName] = useState("");

  return (
    <form action={saveAction} className="space-y-6">
      <input type="hidden" name="version" value={version} />

      <div className="grid gap-6 md:grid-cols-2">
        {RULE_GROUPS.map((group) => (
          <Card key={group.title}>
            <CardHeader>
              <CardTitle>{group.title}</CardTitle>
              <CardDescription>{group.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {group.fields.map((f) => (
                <div key={f.path} className="space-y-1.5">
                  <Label htmlFor={f.path}>{f.label}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={f.path}
                      name={f.path}
                      type="number"
                      inputMode="decimal"
                      step={f.step}
                      value={fields[f.path] ?? ""}
                      onChange={(e) => setFields((prev) => ({ ...prev, [f.path]: e.target.value }))}
                      aria-invalid={errors[f.path] ? true : undefined}
                      aria-describedby={`${f.path}-help`}
                      className="w-28"
                      required
                    />
                    {f.kind === "percent" && <span className="text-sm text-muted-foreground">%</span>}
                  </div>
                  <p id={`${f.path}-help`} className="text-xs text-muted-foreground">
                    {f.help}
                  </p>
                  {errors[f.path] && (
                    <p role="alert" className="text-xs text-destructive">
                      {errors[f.path]}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Save changes</CardTitle>
          <CardDescription>
            Currently version {version}, last saved by {updatedBy} on {updatedAtLabel}. Every save keeps the previous
            version in the history below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="max-w-xs"
              required
              aria-invalid={errors.name ? true : undefined}
            />
            {errors.name && (
              <p role="alert" className="text-xs text-destructive">
                {errors.name}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving || previewing}>
              {saving ? "Saving…" : "Save rules"}
            </Button>
            {/* Preview needs no name; the server still validates every field. */}
            <Button type="submit" variant="outline" formAction={previewAction} formNoValidate disabled={saving || previewing}>
              {previewing ? "Checking…" : "Preview impact"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={saving || previewing}
              onClick={() => {
                setFields(values);
                setName("");
              }}
            >
              Reset
            </Button>
          </div>

          {save.status === "saved" && (
            <Alert>
              <AlertTitle>Saved</AlertTitle>
              <AlertDescription>{save.message}</AlertDescription>
            </Alert>
          )}
          {(save.status === "unchanged" || save.status === "conflict" || (save.status === "error" && save.message)) && (
            <Alert variant={save.status === "unchanged" ? "default" : "destructive"}>
              <AlertTitle>{save.status === "conflict" ? "Rules changed" : save.status === "unchanged" ? "No changes" : "Not saved"}</AlertTitle>
              <AlertDescription>
                {save.message}
                {save.status === "conflict" && (
                  <>
                    {" "}
                    <a href="/rules" className="underline">
                      Reload now
                    </a>
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
          {preview.status === "error" && preview.message && (
            <Alert variant="destructive">
              <AlertTitle>Cannot preview</AlertTitle>
              <AlertDescription>{preview.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {preview.status === "ok" && <ImpactPreview preview={preview} />}
    </form>
  );
}

function ImpactPreview({ preview }: { preview: PreviewState }) {
  const changes = preview.changes ?? [];
  const ruleChanges = preview.ruleChanges ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Impact preview</CardTitle>
        <CardDescription>
          {preview.message} Nothing has been saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {ruleChanges.length === 0 ? (
          <p className="text-sm text-muted-foreground">These values match the saved rules.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {ruleChanges.map((c) => (
              <li key={c.path}>
                <span className="font-medium">{ruleLabel(c.path)}:</span> {formatRuleValue(c.path, c.from)} →{" "}
                {formatRuleValue(c.path, c.to)}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm font-medium">
          {changes.length === 0
            ? `No decisions would change (${preview.totalSkus} SKUs checked).`
            : `${changes.length} of ${preview.totalSkus} decisions would change.`}
        </p>
        {changes.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Now</TableHead>
                <TableHead>With these rules</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changes.map((c) => (
                <TableRow key={c.skuId}>
                  <TableCell>
                    <div className="font-medium">{c.skuId}</div>
                    <div className="text-xs text-muted-foreground">{preview.skuNames?.[c.skuId]}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="h-auto whitespace-normal">{describe(c.before)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="h-auto whitespace-normal">{describe(c.after)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
