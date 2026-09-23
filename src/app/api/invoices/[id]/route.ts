import { apiRoute } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/session";

/**
 * "Delete" a manual bill = void it: the row is kept (marked superseded) so history and audit stay intact.
 * Imported / Zoho bills cannot be voided here – fix them at the source and re-import.
 */
export const DELETE = apiRoute<{ id: string }>(async (_req, ctx, { id }) => {
  const inv = await prisma.invoice.findFirst({ where: { id, organizationId: ctx.orgId, supersededAt: null } });
  if (!inv) throw new ApiError(404, "Bill not found");
  if (inv.source !== "MANUAL") throw new ApiError(400, "Only manually entered bills can be voided. Correct imported bills at the source and re-import.");
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id }, data: { supersededAt: new Date() } });
    await tx.reconciliationResult.updateMany({ where: { invoiceId: id }, data: { isStale: true } });
    await audit(tx, ctx, { action: "INVOICE_VOIDED", entityType: "Invoice", entityId: id, summary: `Manual bill ${inv.invoiceNumber} (${inv.supplierGstin}) voided`, before: { invoiceNumber: inv.invoiceNumber } });
  });
  return { ok: true, note: "Re-run reconciliation to refresh results." };
});
