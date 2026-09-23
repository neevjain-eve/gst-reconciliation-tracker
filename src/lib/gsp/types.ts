/**
 * Pluggable GSTR-2B provider.
 *
 * A provider talks to an **authorised** GSP / ASP / GSTN API on behalf of the taxpayer and returns the
 * GSTR-2B document in the official JSON layout (the same document the GST portal's "Download JSON"
 * produces: `{ data: { gstin, rtnprd, docdata: { b2b, cdnr } } }`).
 *
 * Hard rules for implementations:
 *  - Never scrape the GST portal, automate its login, or solve/bypass CAPTCHAs.
 *  - Never ask for or store GST portal usernames/passwords. GSTN authorisation (OTP / EVC / consent)
 *    happens between the taxpayer and the GSP – this app only ever holds the GSP's API credentials,
 *    and those live in server environment variables, never in the database or the browser.
 */
export interface Gstr2bRequest {
  gstin: string;
  /** 4-digit calendar year, e.g. 2025 */
  year: number;
  /** 1–12 */
  month: number;
}

export interface Gstr2bProvider {
  /** Stable id used in `GSP_PROVIDER` and stored in import-job metadata. */
  readonly id: string;
  /** Human readable name for the UI. */
  readonly name: string;
  /** True when every credential this provider needs is present. */
  isConfigured(): boolean;
  /** One-line description shown on the “GSTR-2B API” tab. */
  describe(): string;
  /** Environment variables the operator has to set (names only – never values). */
  requiredEnv(): string[];
  /** Fetch the GSTR-2B for one GSTIN and month. Throw {@link GspError} with a user-safe message on failure. */
  fetchGstr2b(req: Gstr2bRequest): Promise<unknown>;
}

/** Error whose message is safe to show to end users (never includes credentials or raw upstream bodies). */
export class GspError extends Error {
  constructor(message: string, public status = 502, public retryable = false) {
    super(message);
    this.name = "GspError";
  }
}

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  description: string;
  requiredEnv: string[];
}
