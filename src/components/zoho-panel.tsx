"use client";

import { Link2, RefreshCw, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ZohoRow {
  regId: string;
  label: string;
  connection: null | {
    status: "PENDING_ORG_SELECTION" | "ACTIVE" | "ERROR";
    dc: string;
    orgName: string | null;
    orgOptions: { id: string; name: string }[];
    autoSync: boolean;
    syncFromDate: string | null;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
    billCount: number;
  };
}

const DCS: [string, string][] = [
  ["in", "India (zoho.in)"],
  ["com", "United States (zoho.com)"],
  ["eu", "Europe (zoho.eu)"],
  ["com.au", "Australia (zoho.com.au)"],
  ["jp", "Japan (zoho.jp)"],
  ["ca", "Canada (zohocloud.ca)"],
  ["sa", "Saudi Arabia (zoho.sa)"],
  ["com.cn", "China (zoho.com.cn)"],
];

async function post<T = Record<string, unknown>>(url: string, body: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export function ZohoPanel({ rows, defaultDc, canManage, configured }: { rows: ZohoRow[]; defaultDc: string; canManage: boolean; configured: boolean }) {
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <RowCard key={r.regId} row={r} defaultDc={defaultDc} canManage={canManage} configured={configured} />
      ))}
    </div>
  );
}

function RowCard({ row, defaultDc, canManage, configured }: { row: ZohoRow; defaultDc: string; canManage: boolean; configured: boolean }) {
  const router = useRouter();
  const c = row.connection;
  const [busy, setBusy] = useState<string | null>(null);
  const [dc, setDc] = useState(c?.dc ?? defaultDc);
  const [org, setOrg] = useState(c?.orgOptions[0]?.id ?? "");
  const [from, setFrom] = useState(c?.syncFromDate ?? "");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    try {
      return await fn();
    } finally {
      setBusy(null);
    }
  }

  const connect = () =>
    run("connect", async () => {
      const r = await post<{ url?: string }>("/api/zoho/connect", { gstinRegistrationId: row.regId, dc });
      if (!r.ok || !r.data.url) return toast.error(r.data.error ?? "Could not start the Zoho connection.");
      window.location.assign(r.data.url);
    });

  const sync = (full: boolean) =>
    run("sync", async () => {
      setNote(null);
      const r = await post<{ imported: number; unchanged: number; listed: number; fetched: number; retired: number; remaining: number; errorRows: number }>("/api/zoho/sync", { gstinRegistrationId: row.regId, full });
      if (!r.ok) return toast.error(r.data.error ?? "Sync failed.");
      const d = r.data;
      setNote(`${d.listed} bills in Zoho · ${d.imported} new or changed · ${d.retired} retired · ${d.errorRows} rejected${d.remaining ? ` · ${d.remaining} still queued – sync again to continue` : ""}`);
      toast.success(d.remaining ? "Partial sync done – run it again to continue" : "Zoho Books synced");
      router.refresh();
    });

  const selectOrg = () =>
    run("org", async () => {
      const r = await post("/api/zoho/select-org", { gstinRegistrationId: row.regId, zohoOrganizationId: org });
      if (!r.ok) return toast.error(r.data.error ?? "Could not select the organisation.");
      toast.success("Organisation linked");
      router.refresh();
    });

  const saveSettings = (patch: { autoSync?: boolean; syncFromDate?: string | null }) =>
    run("settings", async () => {
      const r = await post("/api/zoho/settings", { gstinRegistrationId: row.regId, ...patch });
      if (!r.ok) return toast.error(r.data.error ?? "Could not save.");
      toast.success("Saved");
      router.refresh();
    });

  const disconnect = () =>
    run("disconnect", async () => {
      const r = await post("/api/zoho/disconnect", { gstinRegistrationId: row.regId });
      if (!r.ok) return toast.error(r.data.error ?? "Could not disconnect.");
      toast.success("Disconnected from Zoho Books");
      setConfirmDisconnect(false);
      router.refresh();
    });

  return (
    <section className="rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{row.label}</h3>
          {c?.orgName ? <p className="text-xs text-muted-foreground">Zoho Books organisation: {c.orgName}</p> : null}
        </div>
        {!c ? <Badge>Not connected</Badge> : c.status === "ACTIVE" ? <Badge tone="green">Connected</Badge> : c.status === "ERROR" ? <Badge tone="red">Needs reconnecting</Badge> : <Badge tone="amber">Choose organisation</Badge>}
      </div>

      {!c || c.status === "ERROR" ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-56">
            <Label htmlFor={`dc-${row.regId}`}>Zoho data centre</Label>
            <Select id={`dc-${row.regId}`} value={dc} onChange={(e) => setDc(e.target.value)} disabled={!configured || !canManage}>
              {DCS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={connect} disabled={!configured || !canManage || busy !== null}>
            <Link2 /> {c ? "Reconnect" : "Connect Zoho Books"}
          </Button>
          {!canManage ? <p className="text-xs text-muted-foreground">Only an owner or admin can connect Zoho.</p> : null}
          {c?.lastSyncError ? <p className="basis-full text-sm text-destructive">{c.lastSyncError}</p> : null}
        </div>
      ) : null}

      {c?.status === "PENDING_ORG_SELECTION" ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          {c.orgOptions.length ? (
            <>
              <div className="min-w-64">
                <Label htmlFor={`org-${row.regId}`}>Which Zoho Books organisation holds this GSTIN’s bills?</Label>
                <Select id={`org-${row.regId}`} value={org} onChange={(e) => setOrg(e.target.value)}>
                  {c.orgOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button onClick={selectOrg} disabled={!org || !canManage || busy !== null}>
                Use this organisation
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Zoho returned no organisations for the authorising user. Disconnect and connect with a user who can access the books.</p>
          )}
        </div>
      ) : null}

      {c?.status === "ACTIVE" ? (
        <div className="mt-4 space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Bills imported</dt>
              <dd className="tnum font-medium">{c.billCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last synced</dt>
              <dd className="font-medium">{c.lastSyncedAt ?? "Never"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Data centre</dt>
              <dd className="font-medium">{DCS.find(([v]) => v === c.dc)?.[1] ?? c.dc}</dd>
            </div>
          </dl>
          {c.lastSyncError ? <p className="text-sm text-destructive">Last sync failed: {c.lastSyncError}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => sync(false)} disabled={busy !== null}>
              <RefreshCw className={busy === "sync" ? "animate-spin" : ""} /> {busy === "sync" ? "Syncing…" : "Sync now"}
            </Button>
            <Button variant="outline" onClick={() => sync(true)} disabled={busy !== null} title="Re-read every bill, ignoring the unchanged shortcut">
              Full re-sync
            </Button>
          </div>
          {note ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {note}
            </p>
          ) : null}

          {canManage ? (
            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" checked={c.autoSync} disabled={busy !== null} onChange={(e) => saveSettings({ autoSync: e.target.checked })} />
                <span>
                  <span className="block font-medium">Sync automatically every day</span>
                  <span className="block text-xs text-muted-foreground">Runs from the scheduled job (needs CRON_SECRET).</span>
                </span>
              </label>
              <div>
                <Label htmlFor={`from-${row.regId}`}>Only import bills dated on or after</Label>
                <div className="flex gap-2">
                  <Input id={`from-${row.regId}`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  <Button variant="outline" onClick={() => saveSettings({ syncFromDate: from || null })} disabled={busy !== null || from === (c.syncFromDate ?? "")}>
                    Save
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {c && canManage ? (
        <div className="mt-4 border-t pt-3">
          {confirmDisconnect ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Revoke access and remove the connection? Imported bills stay.</span>
              <Button size="sm" variant="destructive" onClick={disconnect} disabled={busy !== null}>
                Yes, disconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmDisconnect(true)}>
              <Unplug /> Disconnect
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
