import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { encrypt, verifyPayload } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getCtx } from "@/lib/session";
import { dcFromLocation, isZohoDc, NONCE_COOKIE, zohoConfigured, type ZohoDc } from "@/lib/zoho/config";
import { exchangeCode, listOrganizations, revokeRefreshToken, ZohoError, type ZohoSession } from "@/lib/zoho/client";

export const dynamic = "force-dynamic";

interface State extends Record<string, unknown> {
  o: string;
  u: string;
  r: string;
  dc: string;
  n: string;
}

function back(req: NextRequest, params: Record<string, string>) {
  const base = process.env.NEXTAUTH_URL || new URL(process.env.ZOHO_REDIRECT_URI || req.url).origin;
  const url = new URL("/sources/zoho", base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.set(NONCE_COOKIE, "", { path: "/api/zoho", maxAge: 0 });
  return res;
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** OAuth redirect target. Verifies state + nonce + the signed-in user, exchanges the code, stores encrypted tokens. */
export async function GET(req: NextRequest) {
  if (!zohoConfigured()) return back(req, { error: "Zoho is not configured on this server." });
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back(req, { error: q.get("error") === "access_denied" ? "You declined access in Zoho." : "Zoho returned an error." });

  const state = verifyPayload<State>(q.get("state") ?? "");
  const nonce = req.cookies.get(NONCE_COOKIE)?.value ?? "";
  const ctx = await getCtx();
  if (!state || !nonce || !same(String(state.n), nonce) || !ctx || ctx.userId !== state.u || ctx.orgId !== state.o) {
    return back(req, { error: "The Zoho authorisation expired or did not start from this browser. Please try again." });
  }
  const code = q.get("code");
  if (!code) return back(req, { error: "Zoho did not return an authorisation code." });

  const reg = await prisma.gstinRegistration.findFirst({ where: { id: state.r, organizationId: ctx.orgId } });
  if (!reg) return back(req, { error: "GSTIN registration not found." });

  // Zoho tells us which data centre the user's account lives in; the code is only valid there.
  const dc: ZohoDc = dcFromLocation(q.get("location")) ?? (isZohoDc(state.dc) ? state.dc : "in");

  try {
    const t = await exchangeCode(dc, code);
    const session: ZohoSession = { connectionId: null, dc, apiDomain: t.apiDomain, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, organizationId: null };
    let orgs;
    try {
      orgs = await listOrganizations(session);
    } catch (e) {
      await revokeRefreshToken(dc, t.refreshToken);
      throw e;
    }
    const only = orgs.length === 1 ? orgs[0] : null;

    const existing = await prisma.zohoConnection.findUnique({ where: { gstinRegistrationId: reg.id } });
    const keepOrg = existing?.zohoOrganizationId ? orgs.find((o) => o.organization_id === existing.zohoOrganizationId) : undefined;
    const org = keepOrg ?? only;
    const data = {
      dc,
      accessTokenEnc: encrypt(t.accessToken),
      refreshTokenEnc: encrypt(t.refreshToken),
      accessTokenExpiresAt: t.expiresAt,
      scope: t.scope,
      apiDomain: t.apiDomain,
      zohoOrganizationId: org?.organization_id ?? null,
      zohoOrganizationName: org?.name ?? null,
      status: org ? ("ACTIVE" as const) : ("PENDING_ORG_SELECTION" as const),
      lastSyncError: null,
      connectedById: ctx.userId,
    };
    const conn = await prisma.zohoConnection.upsert({
      where: { gstinRegistrationId: reg.id },
      create: { organizationId: ctx.orgId, gstinRegistrationId: reg.id, ...data },
      update: data,
    });
    await audit(null, ctx, {
      action: existing ? "ZOHO_RECONNECTED" : "ZOHO_CONNECTED",
      entityType: "ZohoConnection",
      entityId: conn.id,
      summary: `Zoho Books ${existing ? "re-authorised" : "connected"} for GSTIN ${reg.gstin}${org ? ` (${org.name})` : ""}`,
      metadata: { dc, scope: t.scope },
    });
    return back(req, { connected: reg.id });
  } catch (e) {
    console.error("[zoho] callback failed", e instanceof ZohoError ? e.message : e);
    return back(req, { error: e instanceof ZohoError ? e.message : "Could not complete the Zoho connection." });
  }
}
