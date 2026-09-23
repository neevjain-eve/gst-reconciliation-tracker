"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface GstinOption {
  id: string;
  label: string;
}

export function RunReconciliation({ gstins, fys, defaultGstinId, defaultFy, variant = "default" }: { gstins: GstinOption[]; fys: string[]; defaultGstinId?: string; defaultFy: string; variant?: "default" | "outline" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const options: Record<string, number> = {};
    for (const k of ["roundingTolerance", "varianceTolerance"]) {
      const v = f.get(k);
      if (typeof v === "string" && v !== "") options[k] = Number(v);
    }
    const res = await fetch("/api/reconciliation/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gstinRegistrationId: f.get("gstin"), financialYear: f.get("fy"), options }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Reconciliation failed.");
      return;
    }
    toast.success(`Reconciled ${data.stats.books} bills against ${data.stats.gstr2b} GSTR-2B records → ${data.stats.results} results`);
    setOpen(false);
    router.refresh();
  }

  const fyList = fys.includes(defaultFy) ? fys : [defaultFy, ...fys];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} disabled={!gstins.length}>
          <Play /> Run reconciliation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run reconciliation</DialogTitle>
          <DialogDescription>Matches all current bills against GSTR-2B for the year. Your accept / reject decisions, notes and owners are kept.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="run-gstin">Client GSTIN</Label>
            <Select id="run-gstin" name="gstin" defaultValue={defaultGstinId ?? gstins[0]?.id} required>
              {gstins.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="run-fy">Financial year</Label>
            <Select id="run-fy" name="fy" defaultValue={defaultFy}>
              {fyList.map((fy) => (
                <option key={fy} value={fy}>
                  FY {fy}
                </option>
              ))}
            </Select>
          </div>
          <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Tolerances (optional)</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rt">Rounding ₹</Label>
                <Input id="rt" name="roundingTolerance" type="number" min="0" step="0.5" placeholder="1" />
              </div>
              <div>
                <Label htmlFor="vt">Variance ₹</Label>
                <Input id="vt" name="varianceTolerance" type="number" min="0" step="1" placeholder="100" />
              </div>
            </div>
            <p className="field-hint">Differences up to the rounding value are ignored; up to the variance value they show as “matched with variance”; above it, “tax mismatch”.</p>
          </details>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Reconciling…" : "Run"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
