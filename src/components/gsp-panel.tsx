"use client";

import { CloudDownload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/page-header";
import { ImportResult, type ImportSummaryView } from "@/components/upload-form";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  provider: { id: string; name: string; configured: boolean; description: string; requiredEnv: string[] };
  gstins: { id: string; label: string }[];
  fys: string[];
  defaultFy: string;
}

export function GspPanel({ provider, gstins, fys, defaultFy }: Props) {
  const router = useRouter();
  const [gstin, setGstin] = useState(gstins[0]?.id ?? "");
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummaryView | null>(null);

  async function fetchNow(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/gsp/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gstinRegistrationId: gstin, period }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Fetch failed.");
    setResult(data as ImportSummaryView);
    toast.success(`${data.imported} new record${data.imported === 1 ? "" : "s"} imported`);
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-4">
        {!provider.configured ? (
          <Notice tone={provider.id === "none" ? "info" : "warn"}>
            {provider.id === "none" ? "No GSTR-2B API provider is active, so nothing here is required – " : `The selected provider “${provider.name}” is not fully configured on the server (see the panel on the right). Until then, `}
            <a className="font-medium underline" href="/sources/upload">
              upload the GSTR-2B file downloaded from the GST portal
            </a>{" "}
            instead.
          </Notice>
        ) : null}

        <form onSubmit={fetchNow} className="space-y-4 rounded-lg border bg-card p-5 shadow-sm">
          <div>
            <h3 className="text-sm font-semibold">Fetch GSTR-2B</h3>
            <p className="text-xs text-muted-foreground">
              Provider: <span className="font-medium text-foreground">{provider.name}</span> – {provider.description}
            </p>
          </div>
          {gstins.length === 0 ? (
            <Notice tone="warn">Add a client and GSTIN first.</Notice>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="g-gstin">Client GSTIN</Label>
                  <Select id="g-gstin" value={gstin} onChange={(e) => setGstin(e.target.value)} disabled={!provider.configured}>
                    {gstins.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="g-period">Return period</Label>
                  <Input id="g-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} disabled={!provider.configured} required />
                </div>
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={busy || !provider.configured}>
                <CloudDownload /> {busy ? "Fetching…" : "Fetch and import"}
              </Button>
              <p className="text-xs text-muted-foreground">The month replaces any earlier GSTR-2B for the same period. Previous rows are kept in history and your review decisions carry over for unchanged invoices.</p>
            </>
          )}
          {result ? <ImportResult r={result} gstins={gstins} gstin={gstin} fys={fys} defaultFy={defaultFy} /> : null}
        </form>
      </div>

      <aside className="space-y-4">
        <div className="rounded-lg border bg-card p-5 text-sm shadow-sm">
          <h3 className="text-sm font-semibold">How this stays compliant</h3>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li>Only an authorised GSP / GSTN API is used – no portal scraping, no CAPTCHA handling.</li>
            <li>The app never sees or stores GST portal usernames or passwords. The taxpayer authorises the GSP (OTP / consent) on the GSP&apos;s side.</li>
            <li>The GSP&apos;s API credentials live in server environment variables only.</li>
            <li>Whatever the provider returns goes through the same validation and immutable import pipeline as an uploaded file.</li>
          </ul>
        </div>
        <div className="rounded-lg border bg-card p-5 text-sm shadow-sm">
          <h3 className="text-sm font-semibold">Server configuration</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Selected with <code>GSP_PROVIDER</code> (<code>none</code>, <code>mock</code>, <code>http</code> or your own adapter). Variables required by <strong>{provider.name}</strong>:
          </p>
          <ul className="mt-2 space-y-1">
            {provider.requiredEnv.length ? (
              provider.requiredEnv.map((v) => (
                <li key={v}>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{v}</code>
                </li>
              ))
            ) : (
              <li className="text-xs text-muted-foreground">None.</li>
            )}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Details: docs/INTEGRATIONS.md</p>
        </div>
      </aside>
    </div>
  );
}
