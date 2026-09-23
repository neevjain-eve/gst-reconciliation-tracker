import { apiRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { currentFinancialYear } from "@/lib/dates";
import { stateCodeFromGstin } from "@/lib/gstin";
import { ensureFinancialYear } from "@/lib/periods";
import { clientCreateSchema } from "@/lib/schemas";
import { ApiError } from "@/lib/session";

export const GET = apiRoute(async (_req, ctx) => {
  const clients = await prisma.client.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { name: "asc" },
    include: { gstins: { select: { id: true, gstin: true, tradeName: true, isActive: true } } },
  });
  return { clients };
});

export const POST = apiRoute(async (req, ctx) => {
  const input = await parseJson(req, clientCreateSchema);
  if (await prisma.client.findFirst({ where: { organizationId: ctx.orgId, name: input.name } })) throw new ApiError(409, "A client with this name already exists");
  if (await prisma.gstinRegistration.findFirst({ where: { organizationId: ctx.orgId, gstin: input.gstin } })) throw new ApiError(409, "This GSTIN is already registered under another client");

  const created = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({ data: { organizationId: ctx.orgId, name: input.name, pan: input.pan ?? input.gstin.slice(2, 12) } });
    const reg = await tx.gstinRegistration.create({
      data: { organizationId: ctx.orgId, clientId: client.id, gstin: input.gstin, tradeName: input.tradeName || null, stateCode: stateCodeFromGstin(input.gstin) },
    });
    await ensureFinancialYear(tx, ctx.orgId, reg.id, currentFinancialYear());
    await audit(tx, ctx, { action: "CLIENT_CREATED", entityType: "Client", entityId: client.id, summary: `Client “${client.name}” added with GSTIN ${reg.gstin}` });
    return { client, reg };
  });
  return { clientId: created.client.id, gstinRegistrationId: created.reg.id };
});
