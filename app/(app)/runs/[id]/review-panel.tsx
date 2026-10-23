"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { reviewProgress } from "@/lib/override-rate";
import type { RunItemView } from "@/lib/runs/view";
import { EdgeCard } from "./edge-card";
import { EngineTable } from "./engine-table";
import { SubmitPanel } from "./submit-panel";

/** The two review tabs and the submit panel. Read-only once the run is no longer open. */
export function ReviewPanel({
  runId,
  items,
  editable,
  killThreshold,
  killRuns,
  killStreak,
  recentWeeks,
  paused,
  pausedReason,
}: {
  runId: string;
  items: RunItemView[];
  editable: boolean;
  killThreshold: number;
  killRuns: number;
  killStreak: number;
  recentWeeks: number;
  paused: boolean;
  pausedReason: string | null;
}) {
  const engine = items.filter((i) => !i.isEdge);
  const edge = items.filter((i) => i.isEdge);
  const progress = reviewProgress(items);

  return (
    <div className="space-y-6">
      <Tabs defaultValue="engine">
        <TabsList className="h-auto">
          <TabsTrigger value="engine" className="px-3 py-1.5">
            Engine decisions
            <Badge variant="outline">{editable ? `${progress.engineDecided}/${engine.length}` : engine.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="edge" className="px-3 py-1.5">
            Needs your judgment
            <Badge variant={editable && progress.pendingEdge > 0 ? "default" : "outline"}>
              {editable ? `${progress.edgeDecided}/${edge.length}` : edge.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="engine" className="pt-2">
          <Card>
            <CardHeader>
              <CardTitle>Engine decisions</CardTitle>
              <CardDescription>
                The rules decided these {engine.length} SKUs. Approve each as recommended, or edit or reject it with a reason.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EngineTable runId={runId} items={engine} editable={editable} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="edge" className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            {edge.length === 0
              ? "No SKUs were routed to you in this run."
              : "These SKUs tripped a check for something the rules cannot judge, so they have no recommendation. You choose the action, quantity and reason for each."}
          </p>
          {edge.map((item) => (
            <EdgeCard key={item.skuId} runId={runId} item={item} editable={editable} recentWeeks={recentWeeks} />
          ))}
        </TabsContent>
      </Tabs>

      {editable && (
        <SubmitPanel runId={runId} items={items} killThreshold={killThreshold} killRuns={killRuns} killStreak={killStreak} paused={paused} pausedReason={pausedReason} />
      )}
    </div>
  );
}
