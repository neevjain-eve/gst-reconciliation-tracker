import { buildGstin } from "@/lib/gstin";
import { GspError, type Gstr2bProvider, type Gstr2bRequest } from "./types";

/**
 * Deterministic offline provider for demos, local development and tests (`GSP_PROVIDER=mock`).
 * It fabricates a small, valid GSTR-2B document – it never contacts any external service.
 * Refuses to run in production unless explicitly allowed, so sample data can't leak into real books.
 */
export const mockProvider: Gstr2bProvider = {
  id: "mock",
  name: "Mock GSP (sample data)",
  isConfigured: () => process.env.NODE_ENV !== "production" || process.env.GSP_ALLOW_MOCK_IN_PRODUCTION === "true",
  describe: () =>
    mockProvider.isConfigured()
      ? "Returns fabricated sample GSTR-2B data for demos and development. Not connected to GSTN."
      : "Disabled because this is a production build. For a demo deployment only, set GSP_ALLOW_MOCK_IN_PRODUCTION=true.",
  requiredEnv: () => (process.env.NODE_ENV === "production" ? ["GSP_ALLOW_MOCK_IN_PRODUCTION"] : []),
  async fetchGstr2b(req: Gstr2bRequest) {
    if (!mockProvider.isConfigured()) throw new GspError("The mock provider is disabled in production.", 400);
    const mm = String(req.month).padStart(2, "0");
    const rtnprd = `${mm}${req.year}`;
    const supplier = (n: number) => buildGstin("27", ["AAACM1234B", "AABCS5678K", "AAECP9012D"][n % 3]);
    const doc = (i: number, s: number, taxable: number) => {
      const igst = 0;
      const cgst = Math.round(taxable * 0.09 * 100) / 100;
      return {
        inum: `MOCK/${req.year}/${String(i).padStart(4, "0")}`,
        typ: "R",
        dt: `${String(Math.min(27, 3 + i * 4)).padStart(2, "0")}-${mm}-${req.year}`,
        val: Math.round((taxable + cgst * 2) * 100) / 100,
        pos: "27",
        rev: "N",
        itcavl: "Y",
        items: [{ num: 1, rt: 18, txval: taxable, igst, cgst, sgst: cgst, cess: 0 }],
      };
    };
    return {
      data: {
        gstin: req.gstin,
        rtnprd,
        version: "1.0",
        docdata: {
          b2b: [0, 1, 2].map((s) => ({
            ctin: supplier(s),
            trdnm: ["Mock Metals Pvt Ltd", "Mock Stationers", "Mock Packaging LLP"][s],
            supprd: rtnprd,
            supfildt: `11-${String(req.month === 12 ? 1 : req.month + 1).padStart(2, "0")}-${req.month === 12 ? req.year + 1 : req.year}`,
            inv: [doc(s * 2 + 1, s, 10000 * (s + 1)), doc(s * 2 + 2, s, 2500 * (s + 2))],
          })),
        },
      },
    };
  },
};
