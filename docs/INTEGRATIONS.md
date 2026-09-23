# Integrations

This app only ever talks to two external systems, both through their official, authorised APIs. It never automates the GST portal's web UI, solves or bypasses a CAPTCHA, or asks for a GST portal username/password/OTP — there is simply no code path for that.

## Zoho Books (OAuth 2.0)

### How it works

1. **Connect** (`src/app/api/zoho/connect`): the app builds Zoho's standard authorization-code URL (`access_type=offline`, `prompt=consent`, read-only scopes) and redirects the browser to Zoho. The `state` parameter is HMAC-signed with `NEXTAUTH_SECRET`, expires in 10 minutes, and is bound to an `httpOnly` nonce cookie — this is standard OAuth CSRF protection, not something specific to Zoho.
2. **Callback** (`src/app/api/zoho/callback`): Zoho redirects back with a code. The app verifies `state` + nonce + that the same user is still signed in, exchanges the code for an access + refresh token, and stores both **encrypted** (`src/lib/crypto.ts`, AES-256-GCM) on `ZohoConnection`. If the authorising user has more than one Zoho Books organisation, the admin picks which one this GSTIN maps to (`select-org`).
3. **Sync** (`src/lib/zoho/sync.ts`): lists bills via `GET /books/v3/bills` (cheap, paged), decides what actually needs a detail fetch (new, or `last_modified_time` changed since we last saw it — skips everything else, including a small cache of bills we deliberately don't import so they aren't re-checked every time), fetches `GET /books/v3/bills/{id}` for those, maps each one (`src/lib/zoho/mapper.ts`), and imports them through the exact same pipeline as a file upload (`persistImport`) — so the same validation, immutability and audit trail apply. Bills that become draft/void, or vanish from Zoho entirely, are *retired* (superseded) rather than left counting toward ITC.
4. **Token refresh**: `booksGet()` refreshes the access token automatically shortly before it expires, and retries once on a 401; 429s are retried with backoff.
5. **Scheduled sync**: `vercel.json` defines a daily cron hitting `/api/cron/zoho-sync`, authenticated with `Authorization: Bearer $CRON_SECRET`. It processes the least-recently-synced connections first and stops with time to spare inside the serverless function limit; a sync that couldn't finish (`remaining > 0` in the response) picks up where it left off on the next run. Set `CRON_SECRET` to enable it; leave it unset and the endpoint just 401s.
6. **Disconnect**: revokes the refresh token at Zoho and deletes the local (encrypted) copy. Already-imported bills are kept as history — disconnecting stops future syncs, it doesn't erase your books.

### Required setup

Create a **Server-based Application** client in the Zoho API Console for your data centre (e.g. `api-console.zoho.in` for India), with a redirect URI matching `ZOHO_REDIRECT_URI` exactly. Set `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REDIRECT_URI` (and optionally `ZOHO_DC`, `ZOHO_SCOPES`) — see `.env.example`.

### ⚠️ Verify the tax mapping before relying on it

Zoho Books doesn't expose a single canonical "GST breakdown" field on a bill; `mapZohoBill()` reads the supplier GSTIN from `gst_no` (falling back to `vendor_gst_no`/`gstin`), the taxable value from `sub_total` (or derived from `line_items[].item_total` / inclusive-tax total), and IGST/CGST/SGST/Cess by pattern-matching each entry in `taxes[].tax_name` (e.g. "CGST (9%)" → CGST). If a tax entry's name doesn't match a known pattern, or `taxes[]` is empty but the bill has a nonzero `tax_total`, the engine falls back to splitting the total by intra-/inter-state supply and flags a warning on the import job. **This has not been verified against every possible Zoho Books tax configuration** — before trusting the ITC totals, sync a real month, open a handful of synced bills' "Original imported data" on the reconciliation detail page, and compare the CGST/SGST/IGST split against Zoho Books itself. If your organisation names taxes differently, adjust the matching in `src/lib/zoho/mapper.ts`.

Draft, void and pending-approval bills are skipped (not imported, not counted); bills with no supplier GSTIN, or an unregistered/consumer/overseas `gst_treatment`, are skipped as out of scope for GST reconciliation, not treated as errors.

## GSTR-2B (authorised GSP / GSTN API — optional)

By default (`GSP_PROVIDER=none`), GSTR-2B comes in as a file: the Excel or JSON downloaded from the GST portal (My Returns → GSTR-2B → Download), or the app's own CSV/XLSX template. This needs no integration at all and is the recommended path until you have a GSP relationship in place.

If your firm has a paid GSP (GST Suvidha Provider) relationship that exposes GSTR-2B over an API, you can plug it in instead:

### The adapter interface

`src/lib/gsp/types.ts` defines `Gstr2bProvider`:

```ts
interface Gstr2bProvider {
  id: string;
  name: string;
  isConfigured(): boolean;
  describe(): string;
  requiredEnv(): string[];
  fetchGstr2b(req: { gstin: string; year: number; month: number }): Promise<unknown>;
}
```

`fetchGstr2b` must return the **official GSTR-2B JSON layout** (the same shape as the portal's "Download JSON" — `{ data: { gstin, rtnprd, docdata: { b2b: [...], cdnr: [...] } } }`). Everything downstream — `parseGstr2bJson()`, validation, immutable import, matching — is identical to the file-upload path; a provider is only responsible for authenticating to your GSP and returning that document.

### Built-in providers

- **`mock`** (`src/lib/gsp/mock-provider.ts`) — fabricates a small, deterministic, valid GSTR-2B document. Useful for demos and local development; refuses to run in production unless `GSP_ALLOW_MOCK_IN_PRODUCTION=true`. Not connected to anything real.
- **`http`** (`src/lib/gsp/http-provider.ts`) — a generic HTTPS adapter for a GSP that exposes GSTR-2B as a JSON endpoint. Configured entirely through environment variables (base URL, path template with `{gstin}`/`{period}`/`{year}`/`{month}` placeholders, HTTP method, an auth header/scheme + API key, optional extra static headers, and an optional dot-path into the response if the GSTR-2B document is nested). It enforces HTTPS, resolves the final URL against the configured origin only (so a crafted path template or GSTIN can't redirect the request elsewhere), refuses to follow redirects, and caps response size. See `.env.example` for the full list of `GSP_HTTP_*` variables.

### Adding your own provider

If your GSP's contract doesn't fit the generic HTTP adapter (session tokens, multi-step auth, SOAP, etc.), implement `Gstr2bProvider` in a new file under `src/lib/gsp/`, register it in `getProvider()`/the `providers` map in `src/lib/gsp/registry.ts` (or call `registerProvider()` from a module that file imports), and set `GSP_PROVIDER=<your id>`. **The GSP is responsible for the taxpayer's GSTN authorisation** (OTP, EVC, consent — whatever your GSP requires) — that flow happens between the taxpayer and the GSP, outside this app; this app only ever holds the GSP's own API credentials (in server environment variables, never in the database or sent to the browser) and requests the already-authorised data.

### Where GSTR-2B fetches show up

`/sources/gsp` shows the active provider's status and lets a user fetch one GSTIN + return period at a time (`POST /api/gsp/fetch`), rate-limited to once a minute per GSTIN. Each fetch is recorded as an `ImportJob` (`type: GSP_FETCH`, `Gstr2bRecord.source: GSP`) with the same replace-period semantics as a file upload — the fetched month supersedes the previous one, but review decisions on unchanged documents carry over.
