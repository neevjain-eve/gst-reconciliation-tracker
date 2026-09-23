import { apiRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { zohoRegSchema } from "@/lib/schemas";
import { ApiError, requireRole } from "@/lib/session";
import { isZohoDc } from "@/lib/zoho/config";
import { revokeRefreshToken } from "@/lib/zoho/client";

/** Revoke the refresh token at Zoho and delete our copy. Bills already imported stay (as history) – only the link is removed. */
export const POST = apiRoute(async (req, ctx) => {
  requireRole(ctx, "OWNER", "ADMIN");
  const { gstinRegistrationId } = await parseJson(req, zohoRegSchema);
  const conn = await prisma.zohoConnection.findFirst({ where: { gstinRegistrationId, organizationId: ctx.orgId }, include: { gstin: true } });
  if (!conn) throw new ApiError(404, "This GSTIN is not connected to Zoho Books.");
  try {
    await revokeRefreshToken(isZohoDc(conn.dc) ? conn.dc : "in", decrypt(conn.refreshTokenEnc));
  } catch {
    /* undecryptable or already revoked – still remove the local row */
  }
  await prisma.zohoConnection.delete({ where: { id: conn.id } });
  await audit(null, ctx, { action: "ZOHO_DISCONNECTED", entityType: "ZohoConnection", entityId: conn.id, summary: `Zoho Books disconnected from GSTIN ${conn.gstin.gstin}` });
  return { ok: true };
});
