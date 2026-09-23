import { prisma } from "./db";

/** GSTIN dropdown options (with the state code the manual form uses to pick CGST+SGST vs IGST). */
export async function getGstinOptions(orgId: string) {
  const rows = await prisma.gstinRegistration.findMany({
    where: { organizationId: orgId, isActive: true },
    orderBy: [{ client: { name: "asc" } }, { gstin: "asc" }],
    select: { id: true, gstin: true, stateCode: true, client: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, label: `${r.client.name} · ${r.gstin}`, stateCode: r.stateCode, gstin: r.gstin }));
}
