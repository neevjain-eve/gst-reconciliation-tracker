"use client";

import { Download, FileUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Notice } from "@/components/page-header";
import { RunReconciliation } from "@/components/run-reconciliation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Issue {
  row: number;
  field?: string;
  severity: "error" | "warning";
  message: string;
}
export interface ImportSummaryView {
  jobId: string;
  status: string;
  totalRows: number;
  imported: number;
  unchanged: number;
  superseded: number;
  errorRows: number;
  issues: Issue[];
  period?: string;
}

export function UploadForm({ gstins, fys, defaultFy }: { gstins: { id: string; label: string }[]; fys: string[]; defaultFy: string }) {
  const router = useRouter();
  const [type, setType] = useState<"BOOKS" | "GSTR2B">("GSTR2B");
  const [gstin, setGstin] = useState(gstins[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummaryView | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    f.set("type", type);
    f.set("gstinRegistrationId", gstin);
    f.set("replace", f.get("replace") ? "true" : "false");
    f.set("strict", f.get("strict") ? "true" : "false");
    if (type === "BOOKS") f.delete("period");
    const res = await fetch("/api/import/upload", { method: "POST", body: f });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Upload failed.");
      return;
    }
    setResult(data as ImportSummaryView);
    if (data.status === "FAILED") toast.error("Nothing was imported – see the errors below.");
    else toast.success(`${data.imported} new record${data.imported === 1 ? "" : "s"} imported`);
    router.refresh();
  }

  if (!gstins.length) {
    return (
      <Notice tone="warn">
        Add a client and GSTIN first – <Link className="font-medium underline" href="/clients">Clients & GSTINs</Link>.
      </Notice>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <form onSubmit={onSubmit} className="space-y-5 rounded-lg border bg-card p-5 shadow-sm">
        <div role="radiogroup" aria-label="What are you uploading?" className="grid grid-cols-2 gap-2">
          {(
            [
              ["GSTR2B", "GSTR-2B", "Portal Excel / JSON, or template"],
              ["BOOKS", "Purchase register", "Books export (CSV / XLSX)"],
            ] as const
          ).map(([v, title, sub]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={type === v}
              onClick={() => setType(v)}
              className={cn("rounded-md border p-3 text-left transition-colors", type === v ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent")}
            >
              <span className="block text-sm font-medium">{title}</span>
              <span className="block text-xs text-muted-foreground">{sub}</span>
            </button>
          ))}
        </div>

        <div>
          <Label htmlFor="u-gstin">Client GSTIN</Label>
          <Select id="u-gstin" value={gstin} onChange={(e) => setGstin(e.target.value)} required>
            {gstins.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </Select>
        </div>

        {type === "GSTR2B" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="u-period">GSTR-2B return period</Label>
              <Input id="u-period" name="period" type="month" pattern="\d{4}-\d{2}" placeholder="YYYY-MM" />
              <p className="field-hint">Required for CSV/XLSX. Portal JSON carries its own period.</p>
            </div>
            <label className="flex items-start gap-2 self-end rounded-md border p-3 text-sm">
              <input type="checkbox" name="replace" defaultChecked className="mt-0.5 size-4" />
              <span>
                <span className="block font-medium">Replace this period</span>
                <span className="block text-xs text-muted-foreground">File is the complete 2B. Old rows are superseded, identical ones (and your decisions) stay.</span>
              </span>
            </label>
          </div>
        ) : null}

        <div>
          <Label htmlFor="u-file">File</Label>
          <label
            htmlFor="u-file"
            className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-8 text-center hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring"
          >
            <FileUp className="size-6 text-muted-foreground" />
            <span className="text-sm font-medium">{fileName || "Choose a file or drop it here"}</span>
            <span className="text-xs text-muted-foreground">{type === "GSTR2B" ? ".xlsx, .csv or .json" : ".xlsx or .csv"} · max 4 MB</span>
            <input id="u-file" name="file" type="file" required accept={type === "GSTR2B" ? ".xlsx,.csv,.json" : ".xlsx,.csv"} className="sr-only" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
          </label>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="strict" className="mt-0.5 size-4" />
          <span>
            <span className="font-medium">All-or-nothing</span>
            <span className="block text-xs text-muted-foreground">Reject the whole file if any row has an error (otherwise valid rows are imported and bad rows are listed).</span>
          </span>
        </label>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Importing…" : "Import"}
        </Button>

        {result ? <ImportResult r={result} gstins={gstins} gstin={gstin} fys={fys} defaultFy={defaultFy} /> : null}
      </form>

      <aside className="space-y-4">
        <div className="rounded-lg border bg-card p-5 text-sm shadow-sm">
          <h3 className="text-sm font-semibold">GSTR-2B from the portal</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload the Excel or JSON exactly as the GST portal gives it – no reformatting needed. The{" "}
            <Link className="font-medium underline" href="/sources/portal-helper">
              GST portal helper
            </Link>{" "}
            gets you to the download in a couple of clicks after you log in.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold">Sample templates</h3>
          <p className="mt-1 text-xs text-muted-foreground">Column names are flexible (Zoho and Tally exports work as they are), but the templates show the expected layout with valid examples.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["books", "gstr2b"] as const).flatMap((t) =>
              (["xlsx", "csv"] as const).map((fmt) => (
                <Button key={t + fmt} asChild variant="outline" size="sm">
                  <a href={`/api/import/template?type=${t}&format=${fmt}`} download>
                    <Download /> {t === "books" ? "Books" : "GSTR-2B"} .{fmt}
                  </a>
                </Button>
              )),
            )}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-5 text-sm shadow-sm">
          <h3 className="text-sm font-semibold">What gets validated</h3>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li>Supplier GSTIN format (rows rejected) and check digit (warning).</li>
            <li>Invoice date is real, after 1 Jul 2017 and not in the future.</li>
            <li>Amounts are numeric and non-negative; IGST is never combined with CGST/SGST.</li>
            <li>Files: .csv / .xlsx / .json only, size and row limits, signature checked.</li>
            <li>The exact same file cannot be imported twice.</li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Original rows are stored untouched next to the parsed values.</p>
        </div>
      </aside>
    </div>
  );
}

export function ImportResult({ r, gstins, gstin, fys, defaultFy }: { r: ImportSummaryView; gstins: { id: string; label: string }[]; gstin: string; fys: string[]; defaultFy: string }) {
  const failed = r.status === "FAILED";
  const errors = r.issues.filter((i) => i.severity === "error").length;
  return (
    <div className="space-y-3 border-t pt-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={failed ? "red" : r.errorRows ? "amber" : "green"}>{failed ? "Failed – nothing imported" : r.errorRows ? "Imported with errors" : "Imported"}</Badge>
        <span className="text-xs text-muted-foreground">{r.period ? `Period ${r.period}` : ""}</span>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        {[
          ["Rows read", r.totalRows],
          ["New", r.imported],
          ["Unchanged", r.unchanged],
          ["Rejected", r.errorRows],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-md bg-muted/60 p-2">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="tnum text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {r.superseded ? <p className="text-xs text-muted-foreground">{r.superseded} earlier record(s) for this period were superseded (kept in history).</p> : null}
      {r.issues.length ? (
        <div className="max-h-64 overflow-auto rounded-md border text-xs">
          <table className="w-full">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-2 py-1.5 text-left">Row</th>
                <th className="px-2 py-1.5 text-left">Field</th>
                <th className="px-2 py-1.5 text-left">Issue</th>
              </tr>
            </thead>
            <tbody>
              {r.issues.slice(0, 100).map((i, idx) => (
                <tr key={idx} className="border-t">
                  <td className="tnum px-2 py-1.5">{i.row || "—"}</td>
                  <td className="px-2 py-1.5">{i.field ?? ""}</td>
                  <td className={cn("px-2 py-1.5", i.severity === "error" ? "text-red-700" : "text-amber-800")}>{i.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.issues.length > 100 ? <p className="p-2 text-muted-foreground">Showing 100 of {r.issues.length} issues ({errors} errors).</p> : null}
        </div>
      ) : null}
      {!failed ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <RunReconciliation gstins={gstins} fys={fys} defaultGstinId={gstin} defaultFy={defaultFy} />
          <Button asChild variant="outline">
            <Link href="/reconciliation">Open tracker</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
