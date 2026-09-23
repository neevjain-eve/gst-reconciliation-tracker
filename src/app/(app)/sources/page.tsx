import { CheckCircle2, FileSpreadsheet, KeyRound, PenLine, PlugZap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { IMPORT_TYPE_LABEL } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { zohoConfigured } from "@/lib/zoho/config";
import { getProviderInfo } from "@/lib/gsp/registry";
import { requireCtx } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Data sources" };
export const dynamic = "force-dynamic";

const STATUS_TONE = { COMPLETED: "green", COMPLETED_WITH_ERRORS: "amber", FAILED: "red", RUNNING: "blue", PENDING: "neutral" } as const;

export default async function SourcesOverview() {
  const ctx = await requireCtx();
  const [jobs, zohoCount] = await Promise.all([
    prisma.importJob.findMany({
      where: { organizationId: ctx.orgId },
      orderBy: { startedAt: "desc" },
      take: 25,
      include: { gstin: { select: { gstin: true, client: { select: { name: true } } } }, createdBy: { select: { name: true } } },
    }),
    prisma.zohoConnection.count({ where: { organizationId: ctx.orgId, status: "ACTIVE" } }),
  ]);
  const gsp = getProviderInfo();

  const cards = [
    { href: "/sources/zoho", icon: PlugZap, title: "Zoho Books", body: zohoConfigured() ? `${zohoCount} GSTIN${zohoCount === 1 ? "" : "s"} connected via official OAuth. Bills sync automatically.` : "Set the Zoho OAuth credentials to enable automatic bill sync.", ok: zohoCount > 0 },
    { href: "/sources/upload", icon: FileSpreadsheet, title: "Upload GSTR-2B / books", body: "CSV, XLSX or the portal's GSTR-2B Excel / JSON. Works without any API access.", ok: true },
    { href: "/sources/manual", icon: PenLine, title: "Manual entry", body: "Add a single bill with validated GSTIN, dates and tax amounts.", ok: true },
    { href: "/sources/gsp", icon: KeyRound, title: "GSTR-2B via GSP / GSTN API", body: gsp.configured ? `Provider “${gsp.name}” is configured.` : "Optional – plug in an approved GSP. Until then, use file upload.", ok: gsp.configured },
  ];

  return (
    <>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ href, icon: Icon, title, body, ok }) => (
          <Link key={href} href={href} className="group">
            <Card className="h-full p-5 transition-shadow group-hover:shadow-md">
              <div className="mb-3 flex items-center justify-between">
                <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </span>
                {ok ? <CheckCircle2 className="size-4 text-emerald-600" aria-label="Ready" /> : null}
              </div>
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{body}</p>
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-semibold">Import history</h2>
      <div className="rounded-lg border bg-card shadow-sm">
        {jobs.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Nothing imported yet.</p>
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>When</TH>
                <TH>Source</TH>
                <TH>Client / GSTIN</TH>
                <TH className="text-right">Rows</TH>
                <TH className="text-right">New</TH>
                <TH className="text-right">Unchanged</TH>
                <TH className="text-right">Rejected</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {jobs.map((j) => {
                const issues = (j.errors as { row: number; message: string; severity: string }[] | null) ?? [];
                return (
                  <TR key={j.id} className="align-top">
                    <TD className="whitespace-nowrap text-xs">
                      {formatDateTime(j.startedAt)}
                      <span className="block text-muted-foreground">{j.createdBy?.name ?? "Scheduled"}</span>
                    </TD>
                    <TD>
                      {IMPORT_TYPE_LABEL[j.type]}
                      {j.fileName ? <span className="block max-w-[14rem] truncate text-xs text-muted-foreground">{j.fileName}</span> : null}
                    </TD>
                    <TD>
                      {j.gstin?.client.name ?? "—"}
                      <span className="block font-mono text-xs text-muted-foreground">{j.gstin?.gstin}</span>
                    </TD>
                    <TD className="tnum text-right">{j.totalRows}</TD>
                    <TD className="tnum text-right">{j.importedRows}</TD>
                    <TD className="tnum text-right">{j.unchangedRows}</TD>
                    <TD className="tnum text-right">{j.errorRows}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[j.status]}>{j.status.replace(/_/g, " ").toLowerCase()}</Badge>
                      {issues.length ? (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-muted-foreground">{issues.length} issue(s)</summary>
                          <ul className="mt-1 max-h-40 max-w-md space-y-0.5 overflow-auto">
                            {issues.slice(0, 30).map((i, idx) => (
                              <li key={idx} className={i.severity === "error" ? "text-red-700" : "text-amber-800"}>
                                {i.row ? `Row ${i.row}: ` : ""}
                                {i.message}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
