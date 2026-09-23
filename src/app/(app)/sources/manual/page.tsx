import type { Metadata } from "next";
import Link from "next/link";
import { ManualInvoiceForm, VoidInvoiceButton } from "@/components/manual-invoice-form";
import { Notice } from "@/components/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { getGstinOptions } from "@/lib/sources";
import { formatDate, formatINR, num } from "@/lib/utils";

export const metadata: Metadata = { title: "Manual entry" };
export const dynamic = "force-dynamic";

export default async function ManualPage() {
  const ctx = await requireCtx();
  const gstins = await getGstinOptions(ctx.orgId);
  const recent = await prisma.invoice.findMany({
    where: { organizationId: ctx.orgId, source: "MANUAL", supersededAt: null },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: { gstin: { select: { gstin: true } } },
  });

  if (!gstins.length) {
    return (
      <Notice tone="warn">
        Add a client and GSTIN first – <Link className="font-medium underline" href="/clients">Clients & GSTINs</Link>.
      </Notice>
    );
  }

  return (
    <div className="space-y-6">
      <ManualInvoiceForm gstins={gstins.map((g) => ({ id: g.id, label: g.label, stateCode: g.stateCode }))} />
      <section>
        <h2 className="mb-2 text-sm font-semibold">Recently entered bills</h2>
        <div className="rounded-lg border bg-card shadow-sm">
          {recent.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No manual bills yet.</p>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Date</TH>
                  <TH>Supplier</TH>
                  <TH>Invoice no.</TH>
                  <TH className="text-right">Taxable</TH>
                  <TH className="text-right">Tax</TH>
                  <TH>Client GSTIN</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {recent.map((i) => (
                  <TR key={i.id}>
                    <TD className="whitespace-nowrap">{formatDate(i.invoiceDate)}</TD>
                    <TD>
                      <span className="block max-w-[14rem] truncate">{i.supplierName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{i.supplierGstin}</span>
                    </TD>
                    <TD>{i.invoiceNumber}</TD>
                    <TD className="tnum text-right">{formatINR(i.taxableValue.toString())}</TD>
                    <TD className="tnum text-right">{formatINR(num(i.igst) + num(i.cgst) + num(i.sgst) + num(i.cess))}</TD>
                    <TD className="font-mono text-xs">{i.gstin.gstin}</TD>
                    <TD className="text-right">
                      <VoidInvoiceButton id={i.id} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}
