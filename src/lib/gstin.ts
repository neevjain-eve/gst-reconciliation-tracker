/**
 * GSTIN helpers.
 * Layout: 2-digit state code · 10-char PAN · entity number (1-9/A-Z) · 'Z' · check character.
 */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const VALID_STATE_CODES = new Set([
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, "0")),
  "97", // Other Territory
  "99", // Centre Jurisdiction
]);

export function normalizeGstin(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\s ]/g, "")
    .toUpperCase();
}

/** Compute the 15th (check) character from the first 14 characters (GSTN mod-36 algorithm). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]);
    if (value < 0) throw new Error("Invalid GSTIN character");
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export function hasValidGstinFormat(gstin: string): boolean {
  return GSTIN_RE.test(gstin) && VALID_STATE_CODES.has(gstin.slice(0, 2));
}

export function hasValidGstinChecksum(gstin: string): boolean {
  return hasValidGstinFormat(gstin) && gstinCheckChar(gstin.slice(0, 14)) === gstin[14];
}

/** Full validation: format + state code + check character. */
export function isValidGstin(raw: unknown): boolean {
  return hasValidGstinChecksum(normalizeGstin(raw));
}

export function panFromGstin(gstin: string): string {
  return gstin.slice(2, 12);
}

export function stateCodeFromGstin(gstin: string): string {
  return gstin.slice(0, 2);
}

/** Build a syntactically valid GSTIN (used by seed data and tests). */
export function buildGstin(stateCode: string, pan: string, entity = "1"): string {
  const first14 = `${stateCode}${pan}${entity}Z`;
  return first14 + gstinCheckChar(first14);
}

const STATE_NAMES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
  "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh",
  "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra",
  "28": "Andhra Pradesh (old)", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
};

export function stateName(code: string): string {
  return STATE_NAMES[code] ?? code;
}
