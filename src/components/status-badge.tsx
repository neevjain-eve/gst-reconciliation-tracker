import { Badge } from "@/components/ui/badge";
import { DECISION_META, STATUS_META } from "@/lib/constants";
import type { DecisionStr, ReconStatusStr } from "@/lib/constants-types";

export function StatusBadge({ status }: { status: ReconStatusStr }) {
  const m = STATUS_META[status];
  return (
    <Badge tone={m.tone} title={m.hint}>
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}
    </Badge>
  );
}

export function DecisionBadge({ decision }: { decision: DecisionStr }) {
  const m = DECISION_META[decision];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
