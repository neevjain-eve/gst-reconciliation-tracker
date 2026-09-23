# How reconciliation works

This document explains the matching engine (`src/lib/reconcile/`) for anyone reviewing results, tuning tolerances, or extending it. The engine itself is pure TypeScript with no I/O — `src/lib/reconcile/run.ts` is the only place that touches the database.

## Inputs

For one GSTIN registration and financial year, the engine compares:

- **Books documents** — active (`supersededAt IS NULL`) `Invoice` rows, from Zoho Books, file upload, or manual entry.
- **GSTR-2B documents** — active `Gstr2bRecord` rows, from file upload or a GSP/GSTN API fetch.

Both sides share the same shape (`EngineDoc`): supplier GSTIN, supplier name, invoice number (raw and normalised), invoice date, document type (invoice / credit note / debit note), taxable value, IGST/CGST/SGST/Cess, invoice value.

## Step 1 — normalise invoice numbers

Suppliers and accountants write the same invoice number differently: `INV/2024-25/00123`, `inv-2024-25-123`, `INV 2024-25 123`. `normalizeInvoiceNumber()` (`src/lib/reconcile/normalize.ts`) upper-cases, splits on every non-alphanumeric separator, strips leading zeros from each numeric run, and concatenates the tokens — all three examples above normalise to `INV202425123`. This runs once at import time and is stored on the row (`invoiceNumberNorm`), so it doesn't need to be recomputed on every reconciliation run.

## Step 2 — duplicates

Within each side, documents that share the same supplier GSTIN + normalised invoice number + document group (invoice vs. credit/debit note) are duplicates. When both a books "cluster" and a GSTR-2B "cluster" exist for the same key, the pair whose taxable value and tax amount are closest is kept as the primary match; every other copy on either side becomes a `DUPLICATE_INVOICE` result explaining which document it duplicates. This is deliberate: if a bill was entered twice, matching *both* copies against a single GSTR-2B record would make the ITC total look larger than it should.

## Step 3 — exact pass

Remaining primaries are matched by an exact key: `supplierGstin | invoiceNumberNorm | docType-group`. A match here is classified as `MATCHED`, `MATCHED_WITH_VARIANCE`, or `TAX_MISMATCH` purely from the size of the amount differences (see "Classifying a pair" below) — the identity is already certain, so no confidence score is needed (`matchMethod: NORMALIZED`, confidence 100).

## Step 4 — fuzzy pass

Whatever is left goes through fuzzy matching. To avoid an O(n·m) comparison, candidates are pre-filtered with four blocking indexes on the GSTR-2B side — same supplier GSTIN, same PAN (first 10 characters of the GSTIN — catches a supplier registered in the wrong state), same normalised invoice number, or same invoice-date + rounded-taxable-value — and only pairs sharing at least one of those go on to full scoring.

**Score** (0–100), in `scorePair()`:

| Component | Max | Rule |
|---|---|---|
| Supplier GSTIN | 35 | 35 if identical; 21 (60%) if same PAN or ≤2-character edit distance; else 0 |
| Invoice number | 30 | 30 × similarity — identical, one containing the other, same trailing digit run, or edit-distance ratio (see `similarity.ts`) |
| Invoice date | 10 | 10 same day; 7 within 3 days; 4 within 31 days; else 0 |
| Taxable value | 15 | 15 within rounding tolerance; 10 within 2%; 5 within 10%; else 0 |
| Total tax | 10 | same bands as taxable value |

Candidates are sorted by score (ties broken deterministically by id) and assigned greedily, one-to-one — the highest-scoring pair is taken first, then the next-highest among what's left, and so on, so no document is matched twice.

- **score ≥ `autoMatchScore`** (default 80): classified automatically. If the GSTIN differs, that's `GSTIN_MISMATCH`; if only the invoice number differs, `INVOICE_NUMBER_MISMATCH`; otherwise it falls through to the same amount-based classification as an exact match.
- **`reviewScore` ≤ score < `autoMatchScore`** (default 55–79): `NEEDS_REVIEW` — plausible, but not confident enough to auto-classify. A human decides.
- **score < `reviewScore`**: not considered a candidate pair at all.

## Step 5 — leftovers

Anything still unmatched becomes `MISSING_IN_GSTR2B` (booked, supplier hasn't reported it — ITC at risk) or `MISSING_IN_BOOKS` (supplier reported it, nothing booked — possible missed ITC or a document that belongs to a different GSTIN).

## Classifying a matched pair

For a pair with a settled identity (exact or high-confidence fuzzy match), `compareDocs()` compares every amount field and takes the largest absolute difference:

- **≤ `roundingTolerance`** (default ₹1): `MATCHED` — the difference is paise-level rounding, not a real discrepancy.
- **≤ `varianceTolerance`** (default ₹100): `MATCHED_WITH_VARIANCE` — small enough to usually accept, but shown as a variance rather than silently ignored.
- **> `varianceTolerance`**: `TAX_MISMATCH` (or `GSTIN_MISMATCH` / `INVOICE_NUMBER_MISMATCH` if the fuzzy pass already flagged an identity difference).

Both tolerances are configurable per run (`RunReconciliation` dialog → "options", or the `options` field of `POST /api/reconciliation/run`); defaults live in `DEFAULT_ENGINE_OPTIONS` (`src/lib/reconcile/types.ts`).

## Credit and debit notes

Credit notes reduce ITC; the engine only ever matches a credit note against another credit note (and a debit note against another debit note) — never against an invoice — by grouping on document type (`group()` in `engine.ts`). ITC amounts (`booksItc`, `gstr2bItc`) are the signed tax total: positive for invoices/debit notes, negative for credit notes, so dashboard and report totals net out correctly without special-casing credit notes everywhere else.

## ITC math

- `booksItc` = tax total of the books document if `itcEligible`, else 0 (signed per docType, see above).
- `gstr2bItc` = tax total of the GSTR-2B document if `itcAvailable`, else 0.
- `matchedItc` = `min(booksItc, gstr2bItc)` for a paired result — so if the supplier reported a lower amount than what's booked, only the lower, supported figure counts as matched.
- Dashboard "Unmatched ITC" = books ITC − matched ITC (aggregated); "Variance" = books ITC − GSTR-2B ITC.

## Re-running reconciliation

`runReconciliation()` (`src/lib/reconcile/run.ts`) is safe to run repeatedly:

- Source documents are read-only inputs; nothing in `Invoice` or `Gstr2bRecord` is ever written by a run.
- Each result gets a deterministic `pairKey` (`<invoiceId|->:<gstr2bRecordId|->`). A result that a human has touched — decision ≠ `PENDING`, an assignee, or a comment — is **kept** on re-run (only its system fields — status, confidence, amounts, explanation — are refreshed); an untouched result is deleted and rebuilt from scratch.
- A touched result whose pair no longer appears in the new run (e.g. the underlying documents were superseded) is marked `isStale: true` rather than deleted, so the decision isn't silently lost — the dashboard and detail page both surface a "data changed, re-run reconciliation" notice for stale rows still shown in old reports.

## Tuning

`roundingTolerance`, `varianceTolerance`, `autoMatchScore`, and `reviewScore` can be overridden per run. Raising `autoMatchScore` makes the engine more conservative (more `NEEDS_REVIEW`, fewer automatic `GSTIN_MISMATCH`/`INVOICE_NUMBER_MISMATCH`); lowering `reviewScore` surfaces more marginal candidates for human review instead of leaving them as `MISSING_IN_*`. The engine is deterministic given the same inputs and options — the same data always reconciles to the same result, which is what makes the unit tests (`tests/engine.test.ts`) meaningful as a specification.
