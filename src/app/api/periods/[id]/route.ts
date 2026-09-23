import { apiRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { periodStatusSchema } from "@/lib/schemas";
import { ApiError } from "@/lib/session";

export const PATCH = apiRoute<{ id: string }>(async (req, ctx, { id }) => {
  const { status } = await parseJson(req, periodStatusSchema);
  const period = await prisma.taxPeriod.findFirst({ where: { id, organizationId: ctx.orgId }, include: { gstin: true } });
  if (!period) throw new ApiError(404, "Tax period not found");
  await prisma.$transaction(async (tx) => {
    await tx.taxPeriod.update({ where: { id }, data: { status } });
    await audit(tx, ctx, {
      action: "PERIOD_STATUS",
      entityType: "TaxPeriod",
      entityId: id,
      summary: `${period.gstin.gstin} ${String(period.month).padStart(2, "0")}-${period.year}: ${period.status} → ${status}`,
      before: { status: period.status },
      after: { status },
    });
  });
  return { ok: true };
});
