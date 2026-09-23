"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function post(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data } as { ok: boolean; data: { error?: string; clientId?: string } };
}

export function AddClientDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const { ok, data } = await post("/api/clients", { name: f.get("name"), gstin: f.get("gstin"), tradeName: f.get("tradeName") || undefined, pan: f.get("pan") || undefined });
    setBusy(false);
    if (!ok) return setError(data.error ?? "Could not add the client.");
    toast.success("Client added");
    setOpen(false);
    router.push(`/clients/${data.clientId}`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add client
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add client</DialogTitle>
          <DialogDescription>A client can have several GSTIN registrations – add the first one now, more later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="c-name">Client name</Label>
            <Input id="c-name" name="name" required minLength={2} maxLength={150} autoFocus />
          </div>
          <div>
            <Label htmlFor="c-gstin">GSTIN</Label>
            <Input id="c-gstin" name="gstin" required maxLength={15} minLength={15} className="uppercase" placeholder="29ABCDE1234F1Z5" autoComplete="off" />
            <p className="field-hint">The 15th character is checked, so typos are caught immediately.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="c-trade">Trade name (optional)</Label>
              <Input id="c-trade" name="tradeName" maxLength={150} />
            </div>
            <div>
              <Label htmlFor="c-pan">PAN (optional)</Label>
              <Input id="c-pan" name="pan" maxLength={10} className="uppercase" placeholder="from GSTIN if blank" />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add client"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddGstinForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    const { ok, data } = await post(`/api/clients/${clientId}/gstins`, { gstin: f.get("gstin"), tradeName: f.get("tradeName") || undefined });
    setBusy(false);
    if (!ok) return setError(data.error ?? "Could not add the GSTIN.");
    toast.success("GSTIN added");
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="sm:w-56">
        <Label htmlFor="g-gstin">Add GSTIN</Label>
        <Input id="g-gstin" name="gstin" required minLength={15} maxLength={15} className="uppercase" placeholder="27ABCDE1234F1Z5" autoComplete="off" />
      </div>
      <div className="sm:w-56">
        <Label htmlFor="g-trade">Trade name / branch</Label>
        <Input id="g-trade" name="tradeName" maxLength={150} />
      </div>
      <Button type="submit" variant="outline" disabled={busy}>
        <Plus /> Add
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive sm:pb-2">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function AddFinancialYearForm({ gstinRegistrationId, suggestions }: { gstinRegistrationId: string; suggestions: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const { ok, data } = await post("/api/periods", { gstinRegistrationId, financialYear: f.get("fy") });
    setBusy(false);
    if (!ok) return toast.error(data.error ?? "Could not create periods");
    toast.success("Tax periods created");
    router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <Select name="fy" aria-label="Financial year to add" className="w-36">
        {suggestions.map((fy) => (
          <option key={fy} value={fy}>
            FY {fy}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="outline" size="sm" disabled={busy}>
        Add year
      </Button>
    </form>
  );
}

export function PeriodStatusSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  async function change(next: string) {
    const prev = value;
    setValue(next);
    const { ok, data } = await post(`/api/periods/${id}`, { status: next }, "PATCH");
    if (!ok) {
      setValue(prev);
      return toast.error(data.error ?? "Could not update status");
    }
    router.refresh();
  }
  return (
    <Select aria-label="Period status" value={value} onChange={(e) => change(e.target.value)} className="h-8 w-32 text-xs">
      <option value="OPEN">Open</option>
      <option value="IN_REVIEW">In review</option>
      <option value="CLOSED">Closed</option>
    </Select>
  );
}
