# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Instead:

- If the repository has GitHub's private vulnerability reporting enabled, use **Security → Report a vulnerability**.
- Otherwise, email the maintainer listed in the repository (or the address in `package.json`) with a description, reproduction steps, and impact. You should get an acknowledgement within a few business days.

Please include, where possible: the affected version/commit, whether it needs authentication, and a minimal reproduction. Do not include real client data, GSTINs, or credentials in a report — use fabricated data that reproduces the issue.

## Scope and design notes for reviewers

This app handles accountants' client data (invoices, GSTINs, tax amounts) and, optionally, Zoho Books OAuth tokens. Things worth knowing when auditing it:

- **Multi-tenancy**: every database query is expected to be scoped by `organizationId`. `src/lib/session.ts` resolves the signed-in user's organisation server-side on every request (re-checked against the database, not just the JWT), and route handlers use `ctx.orgId` — never a client-supplied organisation id.
- **Secrets at rest**: Zoho OAuth access/refresh tokens are encrypted with AES-256-GCM (`src/lib/crypto.ts`, `ENCRYPTION_KEY`) before being stored, and are never sent to the browser.
- **OAuth CSRF**: the Zoho `state` parameter is HMAC-signed and short-lived, and is bound to an `httpOnly` nonce cookie scoped to `/api/zoho` (`src/app/api/zoho/connect`, `.../callback`).
- **SSRF**: outbound calls to Zoho are restricted to Zoho's own API hosts regardless of what a token response claims (`safeApiDomain` in `src/lib/zoho/config.ts`); the generic GSP HTTP adapter requires HTTPS, resolves its path server-side, and refuses to follow redirects (`src/lib/gsp/http-provider.ts`).
- **No GST portal credentials, ever**: there is no code path that accepts, stores, or transmits a GST portal (GSTN) username, password, or OTP, and none that automates the portal's UI. GSTR-2B either comes from a file the user uploads or from an authorised GSP/GSTN API integration the operator configures.
- **File uploads**: size and row limits, magic-byte / structure checks, and GSTIN/date/amount validation happen before anything is persisted (`src/lib/import/`). CSV exports escape leading `= + - @` to prevent formula injection when opened in a spreadsheet.
- **Immutability**: imported rows (`Invoice`, `Gstr2bRecord`) are never edited in place; corrections create a new version and supersede the old one (`supersededAt`/`supersededById`). Reviewer decisions live on `ReconciliationResult`/`Comment`, separate from the source data, and survive re-imports and re-runs.
- **Audit log**: `AuditLog` is append-only from the application's perspective — there is no update/delete route for it.
- **Passwords**: hashed with bcrypt (cost 12). Sessions are JWT-based (NextAuth) with a server-side `isActive` re-check on every request, so deactivating a user takes effect immediately rather than at token expiry.

## Known limitations (not vulnerabilities, but worth knowing before production use)

- There is no in-app rate limiting on the login route beyond what your hosting platform provides — put Vercel's or a WAF's rate limiting in front of `/api/auth` for internet-facing deployments.
- The Zoho bill → tax mapping (`src/lib/zoho/mapper.ts`) infers tax heads from tax *names*; verify it against your own Zoho organisation's tax setup before trusting the totals (see `docs/INTEGRATIONS.md`).
