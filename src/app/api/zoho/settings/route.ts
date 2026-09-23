import { apiRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { toISODate } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { zohoSettingsSchema } from "@/lib/schemas";
import { ApiError, requireRole } from "@/lib/session";

/** Auto-sync on/off and the earliest bill date to import. Changing the date clears the "skipped bills" cache. */
export const POST = apiRoute(async (req, ctx) => {
  requireRole(ctx, "OWNER", "ADMIN");
  const input = await parseJson(req, zohoSettingsSchema);
  const conn = await prisma.zohoConnection.findFirst({ where: { gstinRegistrationId: input.gstinRegistrationId, organizationId: ctx.orgId }, include: { gstin: true } });
  if (!conn) throw new ApiError(404, "This GSTIN is not connected to Zoho Books.");
  const data: { autoSync?: boolean; syncFromDate?: Date | null; skipCache?: object } = {};
  if (input.autoSync !== undefined) data.autoSync = input.autoSync;
  if (input.syncFromDate !== undefined) {
    data.syncFromDate = input.syncFromDate;
    data.skipCache = {};
  }
  await prisma.zohoConnection.update({ where: { id: conn.id }, data });
  await audit(null, ctx, {
    action: "ZOHO_SETTINGS_CHANGED",
    entityType: "ZohoConnection",
    entityId: conn.id,
    summary: `Zoho sync settings changed for ${conn.gstin.gstin}`,
    before: { autoSync: conn.autoSync, syncFromDate: conn.syncFromDate ? toISODate(conn.syncFromDate) : null },
    after: { autoSync: input.autoSync ?? conn.autoSync, syncFromDate: input.syncFromDate === undefined ? (conn.syncFromDate ? toISODate(conn.syncFromDate) : null) : input.syncFromDate ? toISODate(input.syncFromDate) : null },
  });
  return { ok: true };
});
