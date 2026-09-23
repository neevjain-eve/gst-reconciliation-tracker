import { apiRoute, parseJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { zohoSyncSchema } from "@/lib/schemas";
import { ApiError } from "@/lib/session";
import { syncZohoConnection } from "@/lib/zoho/sync";

export const maxDuration = 60;

/** Manual "Sync now". Long syncs are chunked: if `remaining > 0`, press again (or wait for the scheduled job). */
export const POST = apiRoute(async (req, ctx) => {
  const { gstinRegistrationId, full } = await parseJson(req, zohoSyncSchema);
  const conn = await prisma.zohoConnection.findFirst({ where: { gstinRegistrationId, organizationId: ctx.orgId }, select: { id: true } });
  if (!conn) throw new ApiError(404, "This GSTIN is not connected to Zoho Books.");
  return syncZohoConnection(conn.id, ctx.orgId, { userId: ctx.userId, full });
});
