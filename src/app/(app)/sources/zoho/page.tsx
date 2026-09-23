import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/page-header";
import { ZohoPanel, type ZohoRow } from "@/components/zoho-panel";
import { toISODate } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { requireCtx } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";
import { zohoConfig, zohoConfigured } from "@/lib/zoho/config";
import { listOrganizations, sessionFromConnection } from "@/lib/zoho/client";

export const metadata: Metadata = { title: "Zoho Books" };
export const dynamic = "force-dynamic";

export default async function ZohoPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const configured = zohoConfigured();

  const [regs, conns] = await Promise.all([
    prisma.gstinRegistration.findMany({ where: { organizationId: ctx.orgId, isActive: true }, orderBy: [{ client: { name: "asc" } }, { gstin: "asc" }], select: { id: true, gstin: true, client: { select: { name: true } } } }),
    prisma.zohoConnection.findMany({ where: { organizationId: ctx.orgId } }),
  ]);
  const counts = await prisma.invoice.groupBy({ by: ["gstinRegistrationId"], where: { organizationId: ctx.orgId, source: "ZOHO_BOOKS", supersededAt: null }, _count: { _all: true } });
  const countBy = new Map(counts.map((c) => [c.gstinRegistrationId, c._count._all]));
  const byReg = new Map(conns.map((c) => [c.gstinRegistrationId, c]));

  const rows: ZohoRow[] = await Promise.all(
    regs.map(async (r) => {
      const c = byReg.get(r.id);
      let orgOptions: { id: string; name: string }[] = [];
      if (c?.status === "PENDING_ORG_SELECTION") {
        try {
          orgOptions = (await listOrganizations(sessionFromConnection(c))).map((o) => ({ id: o.organization_id, name: o.name }));
        } catch {
          orgOptions = [];
        }
      }
      return {
        regId: r.id,
        label: `${r.client.name} · ${r.gstin}`,
        connection: c
          ? {
              status: c.status,
              dc: c.dc,
              orgName: c.zohoOrganizationName,
              orgOptions,
              autoSync: c.autoSync,
              syncFromDate: c.syncFromDate ? toISODate(c.syncFromDate) : null,
              lastSyncedAt: c.lastSyncedAt ? formatDateTime(c.lastSyncedAt) : null,
              lastSyncError: c.lastSyncError,
              billCount: countBy.get(r.id) ?? 0,
            }
          : null,
      };
    }),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div>
        {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
        {sp.connected ? <Notice tone="ok">Zoho Books connected. Run a sync to import purchase bills.</Notice> : null}
        {!configured ? (
          <Notice tone="warn">
            Zoho OAuth is not configured on this server. Create a server-based client in the Zoho API Console and set <code>ZOHO_CLIENT_ID</code>, <code>ZOHO_CLIENT_SECRET</code> and <code>ZOHO_REDIRECT_URI</code> – see docs/INTEGRATIONS.md.
          </Notice>
        ) : null}
        {rows.length === 0 ? (
          <Notice tone="warn">
            Add a client and GSTIN first – <Link className="font-medium underline" href="/clients">Clients & GSTINs</Link>.
          </Notice>
        ) : (
          <ZohoPanel rows={rows} defaultDc={configured ? zohoConfig().defaultDc : "in"} canManage={ctx.role !== "MEMBER"} configured={configured} />
        )}
      </div>

      <aside className="space-y-4">
        <div className="rounded-lg border bg-card p-5 text-sm shadow-sm">
          <h3 className="text-sm font-semibold">How the sync works</h3>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li>Uses Zoho&apos;s official OAuth 2.0 with read-only scopes (<code>ZohoBooks.bills.READ</code>, <code>ZohoBooks.settings.READ</code>). Your Zoho password is never seen.</li>
            <li>Tokens are encrypted at rest (AES-256-GCM) and never sent to the browser.</li>
            <li>Only bills for suppliers with a GSTIN are imported; draft and void bills are ignored.</li>
            <li>Changed bills become a new version – earlier versions stay in history. Deleted or voided bills stop counting as purchases.</li>
            <li>One Zoho Books organisation is linked per GSTIN registration.</li>
          </ul>
        </div>
        <div className="rounded-lg border bg-card p-5 text-sm shadow-sm">
          <h3 className="text-sm font-semibold">Check your first sync</h3>
          <p className="mt-1 text-xs text-muted-foreground">Tax heads are read from the tax names on each bill (IGST / CGST / SGST / Cess). If your organisation names taxes differently, compare a few synced bills against Zoho before relying on the totals.</p>
        </div>
      </aside>
    </div>
  );
}
