import { apiRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { currentFinancialYear } from "@/lib/dates";
import { stateCodeFromGstin } from "@/lib/gstin";
import { ensureFinancialYear } from "@/lib/periods";
import { gstinCreateSchema } from "@/lib/schemas";
import { ApiError } from "@/lib/session";

export const POST = apiRoute<{ id: string }>(async (req, ctx, { id }) => {
  const input = await parseJson(req, gstinCreateSchema.omit({ clientId: true }));
  const client = await prisma.client.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!client) throw new ApiError(404, "Client not found");
  if (await prisma.gstinRegistration.findFirst({ where: { organizationId: ctx.orgId, gstin: input.gstin } })) throw new ApiError(409, "This GSTIN is already registered");
  const reg = await prisma.$transaction(async (tx) => {
    const r = await tx.gstinRegistration.create({
      data: { organizationId: ctx.orgId, clientId: client.id, gstin: input.gstin, tradeName: input.tradeName || null, stateCode: stateCodeFromGstin(input.gstin) },
    });
    await ensureFinancialYear(tx, ctx.orgId, r.id, currentFinancialYear());
    await audit(tx, ctx, { action: "GSTIN_ADDED", entityType: "GstinRegistration", entityId: r.id, summary: `GSTIN ${r.gstin} added to ${client.name}` });
    return r;
  });
  return { gstinRegistrationId: reg.id };
});
