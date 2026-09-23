import type { Metadata } from "next";
import { GspPanel } from "@/components/gsp-panel";
import { defaultFinancialYear, getFilterOptions } from "@/lib/filters";
import { getProviderInfo } from "@/lib/gsp/registry";
import { requireCtx } from "@/lib/session";
import { getGstinOptions } from "@/lib/sources";

export const metadata: Metadata = { title: "GSTR-2B API" };
export const dynamic = "force-dynamic";

export default async function GspPage() {
  const ctx = await requireCtx();
  const [gstins, options, fy] = await Promise.all([getGstinOptions(ctx.orgId), getFilterOptions(ctx.orgId), defaultFinancialYear(ctx.orgId)]);
  return <GspPanel provider={getProviderInfo()} gstins={gstins.map((g) => ({ id: g.id, label: g.label }))} fys={options.fys} defaultFy={fy} />;
}
