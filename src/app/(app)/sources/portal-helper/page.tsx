import type { Metadata } from "next";
import { PortalHelper } from "@/components/portal-helper";
import { requireCtx } from "@/lib/session";

export const metadata: Metadata = { title: "GST portal helper" };
export const dynamic = "force-dynamic";

export default async function PortalHelperPage() {
  await requireCtx();
  return <PortalHelper />;
}
