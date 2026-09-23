import { apiRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getRegistration } from "@/lib/import/run";
import { ensureFinancialYear } from "@/lib/periods";
import { periodsCreateSchema } from "@/lib/schemas";

export const POST = apiRoute(async (req, ctx) => {
  const input = await parseJson(req, periodsCreateSchema);
  const reg = await getRegistration(ctx.orgId, input.gstinRegistrationId);
  await prisma.$transaction(async (tx) => {
    await ensureFinancialYear(tx, ctx.orgId, reg.id, input.financialYear);
    await audit(tx, ctx, { action: "PERIODS_CREATED", entityType: "GstinRegistration", entityId: reg.id, summary: `Tax periods for FY ${input.financialYear} created for ${reg.gstin}` });
  });
  return { ok: true };
});
