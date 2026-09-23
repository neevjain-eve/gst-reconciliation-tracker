import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { apiRoute, parseJson } from "@/lib/api";
import { signPayload } from "@/lib/crypto";
import { getRegistration } from "@/lib/import/run";
import { zohoConnectSchema } from "@/lib/schemas";
import { ApiError, requireRole } from "@/lib/session";
import { buildAuthorizeUrl, NONCE_COOKIE, zohoConfigured } from "@/lib/zoho/config";

/** Start the official Zoho OAuth 2.0 authorisation-code flow. Returns the Zoho consent URL; the browser navigates to it. */
export const POST = apiRoute(async (req, ctx) => {
  requireRole(ctx, "OWNER", "ADMIN");
  if (!zohoConfigured()) throw new ApiError(503, "Zoho OAuth is not configured on this server (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REDIRECT_URI).");
  const { gstinRegistrationId, dc } = await parseJson(req, zohoConnectSchema);
  const reg = await getRegistration(ctx.orgId, gstinRegistrationId);

  // `state` is HMAC-signed and expires in 10 min; the nonce inside must also match an httpOnly cookie, binding the flow to this browser (CSRF).
  const nonce = randomBytes(16).toString("base64url");
  const state = signPayload({ o: ctx.orgId, u: ctx.userId, r: reg.id, dc, n: nonce }, 600);
  const res = NextResponse.json({ url: buildAuthorizeUrl(dc, state) });
  res.cookies.set(NONCE_COOKIE, nonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/zoho", maxAge: 600 });
  return res;
});
