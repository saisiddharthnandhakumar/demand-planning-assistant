import { Badge } from "@/components/ui/badge";

type Status = "open" | "submitted" | "skipped" | "failed";

const LABEL: Record<Status, string> = {
  open: "Awaiting review",
  submitted: "Submitted",
  skipped: "Skipped (paused)",
  failed: "Failed",
};

const VARIANT: Record<Status, "default" | "secondary" | "destructive" | "outline"> = {
  open: "default",
  submitted: "secondary",
  skipped: "outline",
  failed: "destructive",
};

export function StatusBadge({ status }: { status: Status }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
