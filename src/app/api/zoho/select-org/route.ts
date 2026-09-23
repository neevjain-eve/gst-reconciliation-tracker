import { apiRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { zohoSelectOrgSchema } from "@/lib/schemas";
import { ApiError, requireRole } from "@/lib/session";
import { listOrganizations, sessionFromConnection, ZohoError } from "@/lib/zoho/client";

/** Bind a GSTIN to one Zoho Books organisation (verified against the list Zoho returns for the authorising user). */
export const POST = apiRoute(async (req, ctx) => {
  requireRole(ctx, "OWNER", "ADMIN");
  const { gstinRegistrationId, zohoOrganizationId } = await parseJson(req, zohoSelectOrgSchema);
  const conn = await prisma.zohoConnection.findFirst({ where: { gstinRegistrationId, organizationId: ctx.orgId }, include: { gstin: true } });
  if (!conn) throw new ApiError(404, "This GSTIN is not connected to Zoho Books.");
  let orgs;
  try {
    orgs = await listOrganizations(sessionFromConnection(conn));
  } catch (e) {
    throw new ApiError(502, e instanceof ZohoError ? e.message : "Could not read organisations from Zoho.");
  }
  const org = orgs.find((o) => o.organization_id === zohoOrganizationId);
  if (!org) throw new ApiError(400, "That organisation is not available to the connected Zoho user.");
  await prisma.zohoConnection.update({ where: { id: conn.id }, data: { zohoOrganizationId: org.organization_id, zohoOrganizationName: org.name, status: "ACTIVE", lastSyncError: null, skipCache: {} } });
  await audit(null, ctx, { action: "ZOHO_ORG_SELECTED", entityType: "ZohoConnection", entityId: conn.id, summary: `GSTIN ${conn.gstin.gstin} linked to Zoho Books organisation “${org.name}”` });
  return { ok: true };
});
