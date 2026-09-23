import { GspError, type Gstr2bProvider, type Gstr2bRequest } from "./types";

/**
 * Generic HTTPS adapter for an authorised GSP that exposes GSTR-2B as a JSON GET/POST endpoint.
 * Configure it entirely through environment variables (`GSP_PROVIDER=http`):
 *
 *   GSP_HTTP_NAME          display name, e.g. "Acme GSP"
 *   GSP_HTTP_BASE_URL      https://api.example-gsp.in         (https only)
 *   GSP_HTTP_PATH          /gstr2b?gstin={gstin}&period={period}   placeholders: {gstin} {period} {year} {month}
 *   GSP_HTTP_METHOD        GET (default) | POST   – POST sends {"gstin","period","year","month"} as JSON
 *   GSP_HTTP_AUTH_HEADER   header name for the credential, default "Authorization"
 *   GSP_HTTP_AUTH_SCHEME   optional prefix, e.g. "Bearer" (value becomes "Bearer <token>")
 *   GSP_HTTP_API_KEY       the credential / access token issued by your GSP
 *   GSP_HTTP_EXTRA_HEADERS optional JSON object of additional static headers (client id, secret, …)
 *   GSP_HTTP_RESPONSE_PATH optional dot-path to the GSTR-2B document inside the response, e.g. "result"
 *
 * Every GSP has its own contract – if yours differs (session tokens, OTP flows, envelopes), copy this
 * file, implement `Gstr2bProvider`, and register it in `registry.ts`. The adapter must return the
 * official GSTR-2B JSON layout; `parseGstr2bJson` does the rest.
 */
const TIMEOUT_MS = 25_000;
const MAX_BYTES = 20 * 1024 * 1024;

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function baseUrl(): URL | null {
  const raw = env("GSP_HTTP_BASE_URL");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && u.hostname === "localhost")) return null;
    return u;
  } catch {
    return null;
  }
}

function pick(obj: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export const httpProvider: Gstr2bProvider = {
  id: "http",
  get name() {
    return env("GSP_HTTP_NAME") || "HTTP GSP";
  },
  requiredEnv: () => ["GSP_HTTP_BASE_URL", "GSP_HTTP_PATH", "GSP_HTTP_API_KEY"],
  isConfigured: () => Boolean(baseUrl() && env("GSP_HTTP_PATH") && env("GSP_HTTP_API_KEY")),
  describe: () => "Fetches GSTR-2B from your authorised GSP over HTTPS. Credentials stay in server environment variables.",

  async fetchGstr2b(req: Gstr2bRequest) {
    const base = baseUrl();
    if (!base || !this.isConfigured()) throw new GspError("The GSTR-2B API provider is not configured on the server.", 503);

    const period = `${String(req.month).padStart(2, "0")}${req.year}`;
    const fill = (tpl: string) =>
      tpl
        .replaceAll("{gstin}", encodeURIComponent(req.gstin))
        .replaceAll("{period}", period)
        .replaceAll("{year}", String(req.year))
        .replaceAll("{month}", String(req.month).padStart(2, "0"));

    const path = fill(env("GSP_HTTP_PATH"));
    const url = new URL(path.startsWith("/") ? path : `/${path}`, base);
    // Never let a template (or a crafted GSTIN) redirect the call to another host.
    if (url.origin !== base.origin) throw new GspError("The configured GSP path is invalid.", 500);

    const headers: Record<string, string> = { Accept: "application/json" };
    const scheme = env("GSP_HTTP_AUTH_SCHEME");
    headers[env("GSP_HTTP_AUTH_HEADER") || "Authorization"] = scheme ? `${scheme} ${env("GSP_HTTP_API_KEY")}` : env("GSP_HTTP_API_KEY");
    const extra = env("GSP_HTTP_EXTRA_HEADERS");
    if (extra) {
      try {
        const parsed = JSON.parse(extra) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") headers[k] = v;
      } catch {
        throw new GspError("GSP_HTTP_EXTRA_HEADERS is not valid JSON.", 500);
      }
    }

    const method = env("GSP_HTTP_METHOD").toUpperCase() === "POST" ? "POST" : "GET";
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: method === "POST" ? { ...headers, "Content-Type": "application/json" } : headers,
        body: method === "POST" ? JSON.stringify({ gstin: req.gstin, period, year: req.year, month: req.month }) : undefined,
        signal: ac.signal,
        redirect: "error",
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) throw new GspError("The GSP rejected the credentials, or the taxpayer has not authorised this GSTIN with the GSP. Check the GSP dashboard.", 502);
      if (res.status === 404) throw new GspError("The GSP has no GSTR-2B for this GSTIN and period yet (it is generated on the 14th of the following month).", 404);
      if (res.status === 429) throw new GspError("The GSP is rate-limiting requests. Try again in a minute.", 429, true);
      if (!res.ok) throw new GspError(`The GSP returned an error (HTTP ${res.status}).`, 502, res.status >= 500);

      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) throw new GspError("The GSP response is too large.", 502);
      const text = await res.text();
      if (text.length > MAX_BYTES) throw new GspError("The GSP response is too large.", 502);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new GspError("The GSP did not return valid JSON.", 502);
      }
      const at = env("GSP_HTTP_RESPONSE_PATH");
      const doc = at ? pick(body, at) : body;
      if (!doc) throw new GspError("The GSP response did not contain a GSTR-2B document.", 502);
      return doc;
    } catch (e) {
      if (e instanceof GspError) throw e;
      if ((e as Error).name === "AbortError") throw new GspError("The GSP did not respond in time. Try again.", 504, true);
      throw new GspError("Could not reach the GSP.", 502, true);
    } finally {
      clearTimeout(timer);
    }
  },
};
