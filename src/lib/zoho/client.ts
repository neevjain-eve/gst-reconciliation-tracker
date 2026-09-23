import type { ZohoConnection } from "@prisma/client";
import { decrypt, encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { accountsBase, isZohoDc, safeApiDomain, zohoConfig, type ZohoDc } from "./config";

export class ZohoError extends Error {
  constructor(message: string, public status?: number, public code?: number | string) {
    super(message);
  }
}

const TIMEOUT_MS = 25_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function http(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } catch (e) {
    throw new ZohoError(e instanceof Error && e.name === "AbortError" ? "Zoho did not respond in time" : "Could not reach Zoho");
  } finally {
    clearTimeout(t);
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  api_domain?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

async function tokenRequest(dc: ZohoDc, params: Record<string, string>): Promise<TokenResponse> {
  const c = zohoConfig();
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params });
  const res = await http(`${accountsBase(dc)}/oauth/v2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || data.error || !data.access_token) throw new ZohoError(`Zoho rejected the token request${data.error ? ` (${data.error})` : ""}`, res.status, data.error);
  return data;
}

export async function exchangeCode(dc: ZohoDc, code: string) {
  const c = zohoConfig();
  const t = await tokenRequest(dc, { grant_type: "authorization_code", code, redirect_uri: c.redirectUri });
  if (!t.refresh_token) throw new ZohoError("Zoho did not return a refresh token. Remove the app's access in Zoho and connect again.");
  return {
    accessToken: t.access_token!,
    refreshToken: t.refresh_token,
    expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000),
    apiDomain: safeApiDomain(t.api_domain, dc),
    scope: t.scope ?? c.scopes,
  };
}

export async function revokeRefreshToken(dc: ZohoDc, refreshToken: string) {
  try {
    await http(`${accountsBase(dc)}/oauth/v2/token/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" });
  } catch {
    /* best effort – the local row is deleted regardless */
  }
}

/** Minimal shape needed to call the API; tokens are already decrypted in memory only. */
export interface ZohoSession {
  connectionId: string | null;
  dc: ZohoDc;
  apiDomain: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  organizationId: string | null;
}

export function sessionFromConnection(c: ZohoConnection): ZohoSession {
  return {
    connectionId: c.id,
    dc: isZohoDc(c.dc) ? c.dc : "in",
    apiDomain: c.apiDomain,
    accessToken: decrypt(c.accessTokenEnc),
    refreshToken: decrypt(c.refreshTokenEnc),
    expiresAt: c.accessTokenExpiresAt,
    organizationId: c.zohoOrganizationId,
  };
}

async function refresh(s: ZohoSession) {
  const t = await tokenRequest(s.dc, { grant_type: "refresh_token", refresh_token: s.refreshToken });
  s.accessToken = t.access_token!;
  s.expiresAt = new Date(Date.now() + (t.expires_in ?? 3600) * 1000);
  if (s.connectionId) {
    await prisma.zohoConnection.update({ where: { id: s.connectionId }, data: { accessTokenEnc: encrypt(s.accessToken), accessTokenExpiresAt: s.expiresAt } });
  }
}

/** GET a Zoho Books v3 endpoint. Refreshes the access token when expired / rejected and backs off on rate limits. */
export async function booksGet<T>(s: ZohoSession, path: string, params: Record<string, string | number> = {}): Promise<T> {
  if (s.expiresAt.getTime() - Date.now() < 60_000) await refresh(s);
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  if (s.organizationId && !q.has("organization_id") && path !== "/organizations") q.set("organization_id", s.organizationId);
  const url = `${s.apiDomain}/books/v3${path}?${q}`;

  let refreshed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await http(url, { headers: { Authorization: `Zoho-oauthtoken ${s.accessToken}` } });
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      await refresh(s);
      continue;
    }
    if (res.status === 429) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as { code?: number; message?: string } & T;
    if (!res.ok || (typeof data.code === "number" && data.code !== 0)) {
      throw new ZohoError(data.message ?? `Zoho Books request failed (${res.status})`, res.status, data.code);
    }
    return data as T;
  }
  throw new ZohoError("Zoho Books is rate-limiting requests. Try again in a minute.", 429);
}

export interface ZohoOrg {
  organization_id: string;
  name: string;
  is_default_org?: boolean;
  country_code?: string;
}

export async function listOrganizations(s: ZohoSession): Promise<ZohoOrg[]> {
  const r = await booksGet<{ organizations?: ZohoOrg[] }>(s, "/organizations");
  return r.organizations ?? [];
}

export interface ZohoBillSummary {
  bill_id: string;
  bill_number?: string;
  date?: string;
  status?: string;
  vendor_name?: string;
  last_modified_time?: string;
}

export async function listBillPage(s: ZohoSession, page: number, perPage = 200) {
  const r = await booksGet<{ bills?: ZohoBillSummary[]; page_context?: { has_more_page?: boolean } }>(s, "/bills", { page, per_page: perPage });
  return { bills: r.bills ?? [], hasMore: !!r.page_context?.has_more_page };
}

export async function getBill(s: ZohoSession, billId: string): Promise<Record<string, unknown>> {
  const r = await booksGet<{ bill?: Record<string, unknown> }>(s, `/bills/${encodeURIComponent(billId)}`);
  if (!r.bill) throw new ZohoError("Zoho returned an empty bill");
  return r.bill;
}

export { sleep };
