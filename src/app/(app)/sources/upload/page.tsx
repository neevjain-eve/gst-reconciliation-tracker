import type { Metadata } from "next";
import { UploadForm } from "@/components/upload-form";
import { defaultFinancialYear, getFilterOptions } from "@/lib/filters";
import { requireCtx } from "@/lib/session";
import { getGstinOptions } from "@/lib/sources";

export const metadata: Metadata = { title: "Upload files" };
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const ctx = await requireCtx();
  const [gstins, options, fy] = await Promise.all([getGstinOptions(ctx.orgId), getFilterOptions(ctx.orgId), defaultFinancialYear(ctx.orgId)]);
  return <UploadForm gstins={gstins.map((g) => ({ id: g.id, label: g.label }))} fys={options.fys} defaultFy={fy} />;
}
