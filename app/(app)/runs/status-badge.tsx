import { Badge } from "@/components/ui/badge";

type Status = "open" | "submitted" | "skipped" | "failed";

const LABEL: Record<Status, string> = {
  open: "Awaiting review",
  submitted: "Submitted",
  skipped: "Skipped (paused)",
  failed: "Failed",
};

const VARIANT: Record<Status, "info" | "success" | "neutral" | "danger"> = {
  open: "info",
  submitted: "success",
  skipped: "neutral",
  failed: "danger",
};

export function StatusBadge({ status }: { status: Status }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
