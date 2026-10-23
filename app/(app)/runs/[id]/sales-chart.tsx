"use client";

import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Weekly units for the baseline window of one SKU. Single series, so no legend:
 * the heading above names it. The shaded band is the recent window; the dashed
 * line is the baseline average, labelled directly. Missing weeks are gaps.
 */
export function SalesChart({
  skuId,
  weeks,
  series,
  recentWeeks,
  baselineAvg,
}: {
  skuId: string;
  weeks: string[];
  series: (number | null)[];
  recentWeeks: number;
  baselineAvg: number | null;
}) {
  const data = weeks.map((w, i) => ({ week: w.slice(-3), units: series[i] }));
  const recentStart = data[Math.max(0, data.length - recentWeeks)]?.week;
  const recentEnd = data.at(-1)?.week;
  const values = series.filter((v): v is number => v !== null);
  const summary = `Weekly units sold for ${skuId}, ${data[0]?.week} to ${recentEnd}. Lowest ${Math.min(...values)}, highest ${Math.max(...values)}.`;

  return (
    <figure className="space-y-1">
      <figcaption className="text-xs font-medium text-muted-foreground">Weekly units sold</figcaption>
      <div role="img" aria-label={summary} className="text-foreground">
        <LineChart width={300} height={110} data={data} margin={{ top: 16, right: 14, bottom: 0, left: 14 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="week" tickLine={false} axisLine={false} interval={2} padding={{ left: 6, right: 6 }} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
          <YAxis hide domain={["dataMin - 10", "dataMax + 10"]} />
          {recentStart && recentEnd && <ReferenceArea x1={recentStart} x2={recentEnd} fill="var(--muted)" fillOpacity={0.9} />}
          {baselineAvg !== null && (
            <ReferenceLine
              y={baselineAvg}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 3"
            />
          )}
          <Tooltip
            formatter={(v) => [`${v} units`, "Sold"]}
            labelFormatter={(l) => `Week ${l}`}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)" }}
          />
          <Line type="monotone" dataKey="units" stroke="var(--primary)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </div>
      <p className="text-xs text-muted-foreground">
        Dashed: {weeks.length}-week average{baselineAvg !== null ? ` (${Math.round(baselineAvg)})` : ""}. Shaded: last {recentWeeks} weeks. Hover for exact values.
      </p>
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th>Week</th>
            <th>Units</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={w}>
              <td>{w}</td>
              <td>{series[i] ?? "no data"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
