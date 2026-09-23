/**
 * Zoho Books – official OAuth 2.0 (authorization-code flow, server-based application).
 * Docs: https://www.zoho.com/books/api/v3/oauth/
 */

/** httpOnly cookie that binds an OAuth round-trip to the browser that started it. */
export const NONCE_COOKIE = "zoho_oauth_nonce";

export type ZohoDc = "com" | "in" | "eu" | "com.au" | "jp" | "ca" | "sa" | "com.cn";

export const ZOHO_DCS: ZohoDc[] = ["in", "com", "eu", "com.au", "jp", "ca", "sa", "com.cn"];

export const DC_LABEL: Record<ZohoDc, string> = {
  in: "India (zoho.in)",
  com: "United States (zoho.com)",
  eu: "Europe (zoho.eu)",
  "com.au": "Australia (zoho.com.au)",
  jp: "Japan (zoho.jp)",
  ca: "Canada (zohocloud.ca)",
  sa: "Saudi Arabia (zoho.sa)",
  "com.cn": "China (zoho.com.cn)",
};

const ACCOUNTS_HOST: Record<ZohoDc, string> = {
  in: "accounts.zoho.in",
  com: "accounts.zoho.com",
  eu: "accounts.zoho.eu",
  "com.au": "accounts.zoho.com.au",
  jp: "accounts.zoho.jp",
  ca: "accounts.zohocloud.ca",
  sa: "accounts.zoho.sa",
  "com.cn": "accounts.zoho.com.cn",
};

/** Zoho reports the user's data centre in the redirect as `location`. */
const LOCATION_TO_DC: Record<string, ZohoDc> = { us: "com", in: "in", eu: "eu", au: "com.au", jp: "jp", ca: "ca", sa: "sa", cn: "com.cn" };

export function isZohoDc(v: unknown): v is ZohoDc {
  return typeof v === "string" && (ZOHO_DCS as string[]).includes(v);
}

export function dcFromLocation(location: string | null | undefined): ZohoDc | null {
  return location ? (LOCATION_TO_DC[location.toLowerCase()] ?? null) : null;
}

export const accountsBase = (dc: ZohoDc) => `https://${ACCOUNTS_HOST[dc]}`;

/** Only ever call Zoho-owned API hosts, whatever a token response says (prevents SSRF via a tampered api_domain). */
export function safeApiDomain(candidate: string | undefined, dc: ZohoDc): string {
  const fallback = `https://www.zohoapis.${dc}`;
  if (!candidate) return fallback;
  return /^https:\/\/www\.zohoapis\.(com|in|eu|com\.au|jp|ca|sa|com\.cn)$/.test(candidate) ? candidate : fallback;
}

export function zohoConfigured(): boolean {
  return !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REDIRECT_URI);
}

export function zohoConfig() {
  if (!zohoConfigured()) throw new Error("Zoho OAuth is not configured (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REDIRECT_URI).");
  const dc = process.env.ZOHO_DC;
  return {
    clientId: process.env.ZOHO_CLIENT_ID!,
    clientSecret: process.env.ZOHO_CLIENT_SECRET!,
    redirectUri: process.env.ZOHO_REDIRECT_URI!,
    defaultDc: (isZohoDc(dc) ? dc : "in") as ZohoDc,
    scopes: process.env.ZOHO_SCOPES || "ZohoBooks.bills.READ,ZohoBooks.settings.READ",
  };
}

export function buildAuthorizeUrl(dc: ZohoDc, state: string): string {
  const c = zohoConfig();
  const q = new URLSearchParams({
    scope: c.scopes,
    client_id: c.clientId,
    response_type: "code",
    access_type: "offline", // ask for a refresh token
    prompt: "consent",
    redirect_uri: c.redirectUri,
    state,
  });
  return `${accountsBase(dc)}/oauth/v2/auth?${q}`;
}
