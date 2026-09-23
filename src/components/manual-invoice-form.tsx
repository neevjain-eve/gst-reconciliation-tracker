"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface GstinOpt {
  id: string;
  label: string;
  stateCode: string;
}

const RATES = ["0", "5", "12", "18", "28"];
const r2 = (n: number) => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);

export function ManualInvoiceForm({ gstins }: { gstins: GstinOpt[] }) {
  const router = useRouter();
  const [gstinId, setGstinId] = useState(gstins[0]?.id ?? "");
  const [supplierGstin, setSupplierGstin] = useState("");
  const [taxable, setTaxable] = useState("");
  const [rate, setRate] = useState("");
  const [igst, setIgst] = useState("");
  const [cgst, setCgst] = useState("");
  const [sgst, setSgst] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formKey, setFormKey] = useState(0);

  const clientState = gstins.find((g) => g.id === gstinId)?.stateCode;
  const supplierState = supplierGstin.slice(0, 2);
  const interState = useMemo(() => !!clientState && supplierState.length === 2 && supplierState !== clientState, [clientState, supplierState]);

  function autoTax(nextTaxable: string, nextRate: string, nextSupplier: string) {
    if (nextRate === "") return;
    const t = Number(nextTaxable);
    if (!Number.isFinite(t) || nextTaxable === "") {
      setIgst("");
      setCgst("");
      setSgst("");
      return;
    }
    const total = (t * Number(nextRate)) / 100;
    const inter = !!clientState && nextSupplier.length >= 2 && nextSupplier.slice(0, 2) !== clientState;
    if (inter) {
      setIgst(r2(total));
      setCgst("0.00");
      setSgst("0.00");
    } else {
      setIgst("0.00");
      setCgst(r2(total / 2));
      setSgst(r2(total / 2));
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const f = new FormData(e.currentTarget);
    const body = {
      gstinRegistrationId: gstinId,
      docType: f.get("docType"),
      supplierGstin,
      supplierName: f.get("supplierName"),
      invoiceNumber: f.get("invoiceNumber"),
      invoiceDate: f.get("invoiceDate"),
      placeOfSupply: f.get("placeOfSupply") || undefined,
      reverseCharge: f.get("reverseCharge") === "on",
      itcEligible: f.get("itcEligible") === "on",
      taxableValue: taxable,
      igst,
      cgst,
      sgst,
      cess: f.get("cess"),
      invoiceValue: f.get("invoiceValue"),
      notes: f.get("notes") || undefined,
    };
    const res = await fetch("/api/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not save the bill.");
      if (Array.isArray(data.issues)) setFieldErrors(Object.fromEntries(data.issues.map((i: { path: string; message: string }) => [i.path, i.message])));
      return;
    }
    toast.success("Bill added. Run reconciliation to match it.");
    setSupplierGstin("");
    setTaxable("");
    setRate("");
    setIgst("");
    setCgst("");
    setSgst("");
    setFormKey((k) => k + 1);
    router.refresh();
  }

  const err = (k: string) => (fieldErrors[k] ? <p className="mt-1 text-xs text-destructive">{fieldErrors[k]}</p> : null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form key={formKey} onSubmit={onSubmit} className="space-y-5 rounded-lg border bg-card p-5 shadow-sm">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="m-gstin">Client GSTIN (recipient)</Label>
          <Select id="m-gstin" value={gstinId} onChange={(e) => setGstinId(e.target.value)} required>
            {gstins.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="m-type">Document type</Label>
          <Select id="m-type" name="docType" defaultValue="INVOICE">
            <option value="INVOICE">Tax invoice / bill</option>
            <option value="CREDIT_NOTE">Credit note (reduces ITC)</option>
            <option value="DEBIT_NOTE">Debit note</option>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="m-sgstin">Supplier GSTIN</Label>
          <Input
            id="m-sgstin"
            value={supplierGstin}
            onChange={(e) => {
              const v = e.target.value.toUpperCase().replace(/\s/g, "");
              setSupplierGstin(v);
              autoTax(taxable, rate, v);
            }}
            required
            minLength={15}
            maxLength={15}
            className="font-mono uppercase"
            placeholder="29ABCDE1234F1Z5"
            autoComplete="off"
            aria-invalid={!!fieldErrors.supplierGstin}
          />
          {err("supplierGstin")}
        </div>
        <div>
          <Label htmlFor="m-sname">Supplier name</Label>
          <Input id="m-sname" name="supplierName" required maxLength={150} />
          {err("supplierName")}
        </div>
        <div>
          <Label htmlFor="m-pos">Place of supply</Label>
          <Input id="m-pos" name="placeOfSupply" maxLength={60} placeholder="optional" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="m-inv">Invoice number</Label>
          <Input id="m-inv" name="invoiceNumber" required maxLength={50} />
          {err("invoiceNumber")}
        </div>
        <div>
          <Label htmlFor="m-date">Invoice date</Label>
          <Input id="m-date" name="invoiceDate" type="date" required min="2017-07-01" max={today} />
          {err("invoiceDate")}
        </div>
        <div>
          <Label htmlFor="m-val">Invoice value (optional)</Label>
          <Input id="m-val" name="invoiceValue" type="number" step="0.01" min="0" placeholder="taxable + tax" />
        </div>
      </div>

      <fieldset className="rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">Amounts (₹)</legend>
        <div className="grid gap-4 md:grid-cols-6">
          <div className="md:col-span-2">
            <Label htmlFor="m-taxable">Taxable value</Label>
            <Input
              id="m-taxable"
              type="number"
              step="0.01"
              min="0"
              required
              value={taxable}
              onChange={(e) => {
                setTaxable(e.target.value);
                autoTax(e.target.value, rate, supplierGstin);
              }}
              className="tnum"
            />
            {err("taxableValue")}
          </div>
          <div>
            <Label htmlFor="m-rate">GST rate</Label>
            <Select
              id="m-rate"
              value={rate}
              onChange={(e) => {
                setRate(e.target.value);
                autoTax(taxable, e.target.value, supplierGstin);
              }}
            >
              <option value="">Manual</option>
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="m-igst">IGST</Label>
            <Input id="m-igst" type="number" step="0.01" min="0" value={igst} onChange={(e) => setIgst(e.target.value)} className="tnum" />
          </div>
          <div>
            <Label htmlFor="m-cgst">CGST</Label>
            <Input id="m-cgst" type="number" step="0.01" min="0" value={cgst} onChange={(e) => setCgst(e.target.value)} className="tnum" />
          </div>
          <div>
            <Label htmlFor="m-sgst">SGST</Label>
            <Input id="m-sgst" type="number" step="0.01" min="0" value={sgst} onChange={(e) => setSgst(e.target.value)} className="tnum" />
          </div>
        </div>
        {err("igst")}
        <div className="mt-3 grid gap-4 md:grid-cols-6">
          <div className="md:col-span-2">
            <Label htmlFor="m-cess">Cess</Label>
            <Input id="m-cess" name="cess" type="number" step="0.01" min="0" className="tnum" />
          </div>
          <p className="self-end text-xs text-muted-foreground md:col-span-4">
            {rate !== "" && supplierGstin.length >= 2 && clientState ? (interState ? "Inter-state supply → IGST filled automatically." : "Intra-state supply → CGST + SGST filled automatically.") : "Pick a GST rate to fill the tax split from the supplier's state, or type amounts directly."}
          </p>
        </div>
      </fieldset>

      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div>
          <Label htmlFor="m-notes">Notes (optional)</Label>
          <Textarea id="m-notes" name="notes" maxLength={500} rows={2} />
        </div>
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="itcEligible" defaultChecked className="size-4" /> ITC eligible
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="reverseCharge" className="size-4" /> Reverse charge
          </label>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Add bill"}
      </Button>
    </form>
  );
}

export function VoidInvoiceButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const res = await fetch(`/api/invoices/${id}`, { method: "DELETE" });
    setBusy(false);
    setConfirming(false);
    if (!res.ok) return toast.error((await res.json().catch(() => ({}))).error ?? "Could not void the bill");
    toast.success("Bill voided. Re-run reconciliation to refresh results.");
    router.refresh();
  }
  return confirming ? (
    <span className="inline-flex gap-1">
      <Button size="sm" variant="destructive" onClick={run} disabled={busy}>
        Confirm void
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  ) : (
    <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
      Void
    </Button>
  );
}
