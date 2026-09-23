import { AlertTriangle, ArrowLeft, Flag, StickyNote } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/page-header";
import { ReviewPanel } from "@/components/review-panel";
import { DecisionBadge, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DOC_TYPE_LABEL, SOURCE_LABEL } from "@/lib/constants";
import { toISODate } from "@/lib/dates";
import { prisma } from "@/lib/db";
import type { FieldDiff } from "@/lib/reconcile/types";
import { requireCtx } from "@/lib/session";
import { cn, formatDate, formatDateTime, formatINR, monthLabel, num } from "@/lib/utils";

export const metadata: Metadata = { title: "Reconciliation detail" };
export const dynamic = "force-dynamic";

type Kind = "text" | "money" | "date" | "flag";
interface Row {
  label: string;
  kind: Kind;
  books: string | number | boolean | Date | null | undefined;
  gstr2b: string | number | boolean | Date | null | undefined;
  field?: FieldDiff["field"];
}

const SEVERITY_CLS: Record<string, string> = {
  mismatch: "bg-red-50 text-red-900",
  variance: "bg-amber-50 text-amber-900",
  rounding: "bg-slate-50",
  ok: "",
};

function display(v: Row["books"], kind: Kind): string {
  if (v === null || v === undefined || v === "") return "—";
  if (kind === "money") return formatINR(Number(v));
  if (kind === "date") return formatDate(v as Date);
  if (kind === "flag") return v ? "Yes" : "No";
  return String(v);
}

export default async function ResultDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;

  const r = await prisma.reconciliationResult.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      invoice: { include: { importJob: { select: { fileName: true, startedAt: true, type: true } }, vendor: { select: { name: true } } } },
      gstr2bRecord: { include: { importJob: { select: { fileName: true, startedAt: true, type: true } } } },
      taxPeriod: true,
      gstin: { include: { client: { select: { id: true, name: true } } } },
      assignee: { select: { id: true, name: true } },
      decidedBy: { select: { name: true } },
      comments: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      run: { select: { createdAt: true } },
    },
  });
  if (!r) notFound();

  const [history, users] = await Promise.all([
    prisma.auditLog.findMany({ where: { organizationId: ctx.orgId, entityType: "ReconciliationResult", entityId: id }, orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { name: true } } } }),
    prisma.user.findMany({ where: { organizationId: ctx.orgId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const diffs = new Map(((r.differences as FieldDiff[] | null) ?? []).map((d) => [d.field, d]));
  const b = r.invoice;
  const g = r.gstr2bRecord;
  const rows: Row[] = [
    { label: "Supplier GSTIN", kind: "text", books: b?.supplierGstin, gstr2b: g?.supplierGstin, field: "supplierGstin" },
    { label: "Supplier name", kind: "text", books: b?.supplierName, gstr2b: g?.supplierName },
    { label: "Document type", kind: "text", books: b && DOC_TYPE_LABEL[b.docType], gstr2b: g && DOC_TYPE_LABEL[g.docType] },
    { label: "Invoice number", kind: "text", books: b?.invoiceNumber, gstr2b: g?.invoiceNumber, field: "invoiceNumber" },
    { label: "Invoice date", kind: "date", books: b?.invoiceDate, gstr2b: g?.invoiceDate, field: "invoiceDate" },
    { label: "Place of supply", kind: "text", books: b?.placeOfSupply, gstr2b: g?.placeOfSupply },
    { label: "Taxable value", kind: "money", books: b && num(b.taxableValue), gstr2b: g && num(g.taxableValue), field: "taxableValue" },
    { label: "IGST", kind: "money", books: b && num(b.igst), gstr2b: g && num(g.igst), field: "igst" },
    { label: "CGST", kind: "money", books: b && num(b.cgst), gstr2b: g && num(g.cgst), field: "cgst" },
    { label: "SGST / UTGST", kind: "money", books: b && num(b.sgst), gstr2b: g && num(g.sgst), field: "sgst" },
    { label: "Cess", kind: "money", books: b && num(b.cess), gstr2b: g && num(g.cess), field: "cess" },
    { label: "Invoice value", kind: "money", books: b && num(b.invoiceValue), gstr2b: g && num(g.invoiceValue) },
    { label: "Reverse charge", kind: "flag", books: b?.reverseCharge, gstr2b: g?.reverseCharge },
    { label: "ITC eligible / available", kind: "flag", books: b?.itcEligible, gstr2b: g?.itcAvailable },
  ];

  const period = r.taxPeriod ? monthLabel(r.taxPeriod.year, r.taxPeriod.month) : "—";
  const decisionLine = r.decidedBy && r.decidedAt ? `${r.decidedBy.name} · ${formatDateTime(r.decidedAt)}` : null;
  const unsupported = Math.max(num(r.booksItc) - num(r.matchedItc), 0);

  return (
    <>
      <Link href="/reconciliation" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to tracker
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{r.invoiceNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {r.supplierName} · <span className="font-mono">{r.supplierGstin}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <Link className="hover:underline" href={`/clients/${r.gstin.client.id}`}>
              {r.gstin.client.name}
            </Link>{" "}
            · <span className="font-mono">{r.gstin.gstin}</span> · {period} · reconciled {formatDateTime(r.run.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={r.status} />
          <DecisionBadge decision={r.decision} />
        </div>
      </div>

      {r.isStale ? (
        <Notice tone="warn">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="size-4" /> The underlying documents changed after this result was produced. Run reconciliation again for an up-to-date comparison.
          </span>
        </Notice>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Why this status</CardTitle>
              <CardDescription>
                {r.matchMethod === "NONE" ? "No counterpart found" : `Matched by ${r.matchMethod.toLowerCase()} comparison`} · confidence {r.matchMethod === "NONE" ? "n/a" : `${r.confidence}%`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{r.explanation}</p>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                {[
                  ["Books ITC", num(r.booksItc)],
                  ["GSTR-2B ITC", num(r.gstr2bItc)],
                  ["Matched ITC", num(r.matchedItc)],
                ].map(([k, v]) => (
                  <div key={k as string} className="rounded-md bg-muted/60 p-3">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="tnum font-semibold">{formatINR(v as number)}</dd>
                  </div>
                ))}
              </dl>
              {unsupported > 0 ? <p className="mt-2 text-xs text-red-700">{formatINR(unsupported)} of booked ITC is not supported by GSTR-2B.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Side-by-side comparison</CardTitle>
              <CardDescription>Highlighted rows differ. Imported values are shown exactly as stored and are never edited.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Books versus GSTR-2B</caption>
                  <thead className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Field
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Books
                        <span className="block font-normal">{b ? SOURCE_LABEL[b.source] : "not found"}</span>
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        GSTR-2B
                        <span className="block font-normal">{g ? SOURCE_LABEL[g.source] : "not found"}</span>
                      </th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">
                        Difference
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const d = row.field ? diffs.get(row.field) : undefined;
                      const both = b && g;
                      const differs = both && display(row.books, row.kind) !== display(row.gstr2b, row.kind);
                      const severity = d ? d.severity : differs ? "variance" : "ok";
                      const diffVal = both && row.kind === "money" ? Number(row.books) - Number(row.gstr2b) : null;
                      return (
                        <tr key={row.label} className={cn("border-b last:border-0", SEVERITY_CLS[severity])}>
                          <th scope="row" className="px-4 py-2 text-left font-medium">
                            {row.label}
                          </th>
                          <td className={cn("px-4 py-2", row.kind === "money" && "tnum text-right sm:text-left", row.kind === "text" && row.label.includes("GSTIN") && "font-mono text-xs")}>{b ? display(row.books, row.kind) : "—"}</td>
                          <td className={cn("px-4 py-2", row.kind === "money" && "tnum text-right sm:text-left", row.kind === "text" && row.label.includes("GSTIN") && "font-mono text-xs")}>{g ? display(row.gstr2b, row.kind) : "—"}</td>
                          <td className="tnum px-4 py-2 text-right">
                            {diffVal !== null && Math.abs(diffVal) >= 0.005 ? formatINR(diffVal) : row.kind === "date" && d?.diff ? `${d.diff > 0 ? "+" : ""}${d.diff} day${Math.abs(d.diff) === 1 ? "" : "s"}` : ""}
                            {severity !== "ok" && severity !== "rounding" ? <span className="sr-only"> ({severity})</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Books record</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                {b ? (
                  <>
                    <p>
                      Source: {SOURCE_LABEL[b.source]}
                      {b.importJob?.fileName ? ` · ${b.importJob.fileName}` : ""}
                    </p>
                    <p>Imported {formatDateTime(b.createdAt)}</p>
                    {b.externalId ? <p>Zoho bill id: {b.externalId}</p> : null}
                    {b.notes ? <p>Notes: {b.notes}</p> : null}
                    <RawData data={b.rawData} />
                  </>
                ) : (
                  <p>No matching bill in books.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">GSTR-2B record</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                {g ? (
                  <>
                    <p>
                      Source: {SOURCE_LABEL[g.source]}
                      {g.importJob?.fileName ? ` · ${g.importJob.fileName}` : ""}
                    </p>
                    <p>Imported {formatDateTime(g.createdAt)}</p>
                    {g.supplierFilingPeriod ? (
                      <p>
                        Supplier filed for {g.supplierFilingPeriod}
                        {g.supplierFilingDate ? ` on ${formatDate(g.supplierFilingDate)}` : ""}
                      </p>
                    ) : null}
                    {!g.itcAvailable ? <p className="text-amber-800">ITC not available{g.itcReason ? `: ${g.itcReason}` : ""}</p> : null}
                    <RawData data={g.rawData} />
                  </>
                ) : (
                  <p>Supplier has not reported this document in GSTR-2B.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Review</CardTitle>
              <CardDescription>{decisionLine ? `Last decision by ${decisionLine}` : "No decision recorded yet"}</CardDescription>
            </CardHeader>
            <CardContent>
              <ReviewPanel resultId={r.id} decision={r.decision} assigneeId={r.assigneeId} followUpDueDate={r.followUpDueDate ? toISODate(r.followUpDueDate) : null} users={users} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes &amp; follow-ups</CardTitle>
            </CardHeader>
            <CardContent>
              {r.comments.length ? (
                <ul className="space-y-3">
                  {r.comments.map((c) => (
                    <li key={c.id} className="rounded-md border p-3 text-sm">
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                          {c.kind === "FOLLOW_UP" ? <Flag className="size-3.5 text-amber-600" /> : <StickyNote className="size-3.5" />}
                          {c.author.name}
                        </span>
                        <time dateTime={c.createdAt.toISOString()}>{formatDateTime(c.createdAt)}</time>
                      </div>
                      <p className="whitespace-pre-wrap">{c.body}</p>
                      {c.dueDate ? <Badge tone="amber" className="mt-2">Due {formatDate(c.dueDate)}</Badge> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
              <CardDescription>Every manual change to this result</CardDescription>
            </CardHeader>
            <CardContent>
              {history.length ? (
                <ol className="space-y-3 border-l pl-4">
                  {history.map((h) => (
                    <li key={h.id} className="relative text-sm">
                      <span aria-hidden className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" />
                      <p>{h.summary}</p>
                      <p className="text-xs text-muted-foreground">
                        {h.user?.name ?? "System"} · {formatDateTime(h.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">No manual changes yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function RawData({ data }: { data: unknown }) {
  if (data === null || data === undefined) return null;
  return (
    <details className="pt-1">
      <summary className="cursor-pointer text-primary">Original imported data</summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-snug text-foreground">{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}
