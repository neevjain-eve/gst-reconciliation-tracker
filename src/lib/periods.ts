import type { Prisma } from "@prisma/client";
import { monthsOfFinancialYear } from "./dates";

/** Create the 12 monthly tax periods of a financial year for a GSTIN (idempotent). */
export async function ensureFinancialYear(tx: Prisma.TransactionClient, orgId: string, gstinRegistrationId: string, financialYear: string) {
  const months = monthsOfFinancialYear(financialYear);
  await tx.taxPeriod.createMany({
    data: months.map((m) => ({ organizationId: orgId, gstinRegistrationId, financialYear, year: m.year, month: m.month })),
    skipDuplicates: true,
  });
  return months.length;
}
