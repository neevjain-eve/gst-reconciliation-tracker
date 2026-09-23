import { CheckCircle2, CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import { AddMemberDialog } from "@/components/add-member-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { getProviderInfo } from "@/lib/gsp/registry";
import { uploadLimits } from "@/lib/import/parse-file";
import { requireCtx } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import { zohoConfigured } from "@/lib/zoho/config";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const ROLE_LABEL = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" } as const;

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 py-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Configured" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not configured" />}
      <span>{children}</span>
    </li>
  );
}

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const [org, users] = await Promise.all([
    prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { name: true, createdAt: true } }),
    prisma.user.findMany({ where: { organizationId: ctx.orgId }, orderBy: [{ role: "asc" }, { name: "asc" }], select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true } }),
  ]);
  const gsp = getProviderInfo();
  const limits = uploadLimits();
  const canManage = ctx.role !== "MEMBER";

  return (
    <>
      <PageHeader title="Settings" description={`${org?.name ?? ""} · created ${formatDate(org?.createdAt)}`} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Team</CardTitle>
              <CardDescription>Everyone here sees all clients of the organisation. Nobody outside it can.</CardDescription>
            </div>
            {canManage ? <AddMemberDialog /> : null}
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Added</TH>
                </TR>
              </THead>
              <TBody>
                {users.map((u) => (
                  <TR key={u.id}>
                    <TD className="font-medium">
                      {u.name} {u.id === ctx.userId ? <span className="text-xs font-normal text-muted-foreground">(you)</span> : null}
                    </TD>
                    <TD className="text-xs">{u.email}</TD>
                    <TD>
                      <Badge tone={u.role === "MEMBER" ? "neutral" : "blue"}>{ROLE_LABEL[u.role]}</Badge>
                      {!u.isActive ? <Badge tone="red" className="ml-1">Inactive</Badge> : null}
                    </TD>
                    <TD className="text-xs">{formatDate(u.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integrations &amp; security</CardTitle>
            <CardDescription>Read-only status of server configuration. Secrets are never shown.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              <Status ok={zohoConfigured()}>
                <strong>Zoho Books OAuth</strong> – {zohoConfigured() ? "client credentials are set." : "set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_REDIRECT_URI."}
              </Status>
              <Status ok={gsp.configured}>
                <strong>GSTR-2B provider</strong> – {gsp.configured ? `${gsp.name} is active.` : "none. File upload is used until an approved GSP is configured."}
              </Status>
              <Status ok={!!process.env.CRON_SECRET}>
                <strong>Scheduled Zoho sync</strong> – {process.env.CRON_SECRET ? "cron endpoint is protected by CRON_SECRET." : "CRON_SECRET is not set, so the daily sync is disabled."}
              </Status>
              <Status ok={!!process.env.ENCRYPTION_KEY}>
                <strong>Token encryption</strong> – AES-256-GCM {process.env.ENCRYPTION_KEY ? "key present." : "key missing (ENCRYPTION_KEY)."}
              </Status>
              <Status ok={process.env.ALLOW_SIGNUP !== "true"}>
                <strong>Public sign-up</strong> – {process.env.ALLOW_SIGNUP === "true" ? "open: anyone can create a new organisation. Remove ALLOW_SIGNUP=true to close it." : "closed; colleagues are added by an admin."}
              </Status>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Uploads: up to {limits.maxBytes / 1024 / 1024} MB and {limits.maxRows.toLocaleString("en-IN")} rows per file. GST portal credentials are never requested or stored.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
