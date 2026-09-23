import { apiRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getRegistration } from "@/lib/import/run";
import { saveBooksInvoices } from "@/lib/import/persist";
import { r2 } from "@/lib/money";
import { manualInvoiceSchema } from "@/lib/schemas";
import { ApiError } from "@/lib/session";

/** Add one purchase bill through the manual form. Stored as an immutable Invoice row with source MANUAL. */
export const POST = apiRoute(async (req, ctx) => {
  const v = await parseJson(req, manualInvoiceSchema);
  const reg = await getRegistration(ctx.orgId, v.gstinRegistrationId);
  if (v.supplierGstin === reg.gstin) throw new ApiError(400, "Supplier GSTIN cannot be the same as the client's own GSTIN");

  const saved = await prisma.$transaction(async (tx) => {
    const res = await saveBooksInvoices(tx, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      gstinRegistrationId: reg.id,
      source: "MANUAL",
      importJobId: null,
      docs: [
        {
          docType: v.docType,
          supplierGstin: v.supplierGstin,
          supplierName: v.supplierName,
          invoiceNumber: v.invoiceNumber,
          invoiceDate: v.invoiceDate,
          placeOfSupply: v.placeOfSupply || null,
          reverseCharge: v.reverseCharge,
          itc: v.itcEligible,
          taxableValue: r2(v.taxableValue),
          igst: r2(v.igst),
          cgst: r2(v.cgst),
          sgst: r2(v.sgst),
          cess: r2(v.cess),
          invoiceValue: r2(v.invoiceValue ?? v.taxableValue + v.igst + v.cgst + v.sgst + v.cess),
          notes: v.notes || null,
          raw: { entered: "manual form", by: ctx.email },
        },
      ],
    });
    if (!res.imported) throw new ApiError(409, "An identical bill has already been entered for this GSTIN");
    await audit(tx, ctx, {
      action: "INVOICE_CREATED",
      entityType: "Invoice",
      entityId: res.createdIds?.[0],
      summary: `Manual bill ${v.invoiceNumber} from ${v.supplierName} (${v.supplierGstin}) added`,
      after: { invoiceNumber: v.invoiceNumber, supplierGstin: v.supplierGstin, taxableValue: v.taxableValue },
    });
    return res;
  });
  return { id: saved.createdIds?.[0] };
});
