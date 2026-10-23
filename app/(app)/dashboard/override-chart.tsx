"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface OverridePoint {
  id: string;
  /** e.g. "23 Oct" */
  label: string;
  /** percentage 0-100 */
  rate: number;
  breach: boolean;
  overridden: number;
  engineTotal: number;
}

/**
 * Override rate per submitted run, with the kill-switch limit as a reference
 * line. One series, so no legend: the heading names it. Bars above the limit use
 * the destructive colour AND say "above limit" in the tooltip, the label rule
 * below and the table view, so colour is never the only cue.
 */
export function OverrideChart({ points, limitPct }: { points: OverridePoint[]; limitPct: number }) {
  const max = Math.max(limitPct + 10, Math.ceil(Math.max(...points.map((p) => p.rate)) / 10) * 10 + 10);
  const labelFor = (id: string) => points.find((p) => p.id === id)?.label ?? id;

  return (
    <figure className="space-y-3">
      <div role="img" aria-label={`Override rate for the last ${points.length} submitted runs against a ${limitPct}% limit. Details are in the table below.`}>
        <ResponsiveContainer width="100%" height={240} initialDimension={{ width: 640, height: 240 }}>
          <BarChart data={points} margin={{ top: 22, right: 16, bottom: 4, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="id" tickFormatter={labelFor} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
            <YAxis domain={[0, max]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={44} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              formatter={(v) => [`${Number(v).toFixed(1)}%`, "Override rate"]}
              labelFormatter={(id) => {
                const p = points.find((x) => x.id === id);
                return p ? `${p.label} · run ${p.id.slice(0, 8)} · ${p.overridden} of ${p.engineTotal} overridden${p.breach ? " · ABOVE LIMIT" : ""}` : String(id);
              }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)" }}
            />
            <ReferenceLine y={limitPct} stroke="var(--muted-foreground)" strokeDasharray="5 4" label={{ value: `${limitPct}% limit`, position: "insideTopRight", fontSize: 12, fill: "var(--muted-foreground)" }} />
            <Bar dataKey="rate" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
              {points.map((p) => (
                <Cell key={p.id} fill={p.breach ? "var(--destructive)" : "var(--primary)"} />
              ))}
              <LabelList dataKey="rate" position="top" formatter={(v) => `${Number(v).toFixed(1)}%`} style={{ fontSize: 11, fill: "var(--foreground)" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Red bars are above the {limitPct}% limit. Override rate = edited or rejected engine decisions ÷ all engine decisions in the run (SKUs routed to the planner are excluded).
      </figcaption>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show as a table</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="py-1 pr-4 font-medium">Run</th>
              <th className="py-1 pr-4 font-medium">Submitted</th>
              <th className="py-1 pr-4 font-medium">Overridden</th>
              <th className="py-1 pr-4 font-medium">Rate</th>
              <th className="py-1 font-medium">Against limit</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="py-1 pr-4">{p.id.slice(0, 8)}</td>
                <td className="py-1 pr-4">{p.label}</td>
                <td className="py-1 pr-4">
                  {p.overridden} of {p.engineTotal}
                </td>
                <td className="py-1 pr-4 tabular-nums">{p.rate.toFixed(1)}%</td>
                <td className="py-1">{p.breach ? "Above limit" : "Within limit"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
