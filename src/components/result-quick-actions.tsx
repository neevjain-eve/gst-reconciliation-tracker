"use client";

import { Check, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DECISION_META } from "@/lib/constants";
import type { DecisionStr } from "@/lib/constants-types";

/** One-click decisions from the tracker table. Full notes / owner / due date live on the detail page. */
export function ResultQuickActions({ id, decision, label }: { id: string; decision: DecisionStr; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function set(next: DecisionStr) {
    if (next === decision) return;
    setBusy(true);
    const res = await fetch(`/api/reconciliation/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: next }) });
    setBusy(false);
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Could not save the decision.");
    toast.success(`${label}: ${DECISION_META[next].label}`);
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={`Set decision for ${label}`} disabled={busy}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Mark as</DropdownMenuLabel>
        {(Object.keys(DECISION_META) as DecisionStr[]).map((d) => (
          <DropdownMenuItem key={d} onSelect={() => set(d)}>
            <span className="flex w-4 justify-center">{d === decision ? <Check className="size-3.5" /> : null}</span>
            {DECISION_META[d].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
