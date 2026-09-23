import { mapSheet } from "./rows";
import { parseGstr2bJson } from "./gstr2b-json";
import { detectFileKind, parseCsv, parseXlsx, uploadLimits, UploadError } from "./parse-file";
import type { ParseOutcome } from "./types";

function combine(outcomes: ParseOutcome[]): ParseOutcome {
  return {
    docs: outcomes.flatMap((o) => o.docs),
    issues: outcomes.flatMap((o) => o.issues),
    totalRows: outcomes.reduce((s, o) => s + o.totalRows, 0),
    errorRows: outcomes.reduce((s, o) => s + o.errorRows, 0),
  };
}

/** Parse an uploaded books (purchase register) file – CSV or XLSX. */
export async function parseBooksUpload(name: string, buf: Buffer, now = new Date()): Promise<ParseOutcome> {
  const limits = uploadLimits();
  const kind = detectFileKind(name, buf);
  if (kind === "json") throw new UploadError("Books uploads must be CSV or XLSX. JSON is only supported for GSTR-2B.");
  const sheets = kind === "csv" ? parseCsv(buf, limits) : await parseXlsx(buf, limits);
  const outcomes = sheets.map((s) => mapSheet(s, "books", { now }));
  const usable = outcomes.filter((o) => o.docs.length || o.totalRows);
  return usable.length ? combine(usable) : outcomes[0];
}

/**
 * Parse an uploaded GSTR-2B file: portal JSON, portal Excel (B2B / B2B-CDNR sheets) or our CSV/XLSX template.
 */
export async function parseGstr2bUpload(name: string, buf: Buffer, now = new Date()): Promise<ParseOutcome> {
  const limits = uploadLimits();
  const kind = detectFileKind(name, buf);
  if (kind === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(buf.toString("utf8"));
    } catch {
      throw new UploadError("The file is not valid JSON.");
    }
    const out = parseGstr2bJson(parsed);
    if (out.docs.length > limits.maxRows) throw new UploadError(`File has more than ${limits.maxRows} documents.`);
    return out;
  }
  if (kind === "csv") {
    return mapSheet(parseCsv(buf, limits)[0], "gstr2b", { now });
  }
  const sheets = await parseXlsx(buf, limits);
  // Portal workbooks: use only the B2B and B2B-CDNR tabs (skip summaries, B2BA amendments, ISD, imports…).
  const portal = sheets.filter((s) => /^b2b(-|\s)?(cdnr)?$/i.test(s.name.trim()) && !/a$/i.test(s.name.trim()));
  const chosen = portal.length ? portal : sheets;
  const outcomes = chosen.map((s) => mapSheet(s, "gstr2b", { now, defaultDocType: /cdnr/i.test(s.name) ? "CREDIT_NOTE" : "INVOICE" }));
  const usable = outcomes.filter((o) => o.docs.length || o.totalRows);
  return usable.length ? combine(usable) : outcomes[0];
}
