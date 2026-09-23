"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input, Select } from "@/components/ui/input";
import { DECISION_META, STATUS_META, STATUS_ORDER } from "@/lib/constants";
import { monthLabel } from "@/lib/utils";

export interface FilterOptionsLite {
  clients: { id: string; name: string; gstins: { id: string; gstin: string; tradeName: string | null }[] }[];
  fys: string[];
  months: { value: string; year: number; month: number; fy: string }[];
  vendors: { id: string; name: string; gstin: string }[];
  users: { id: string; name: string }[];
}

type Show = Partial<Record<"client" | "gstin" | "fy" | "period" | "vendor" | "status" | "decision" | "assignee" | "search", boolean>>;

/** URL-driven filters: every change rewrites the query string, so views are shareable and server-rendered. */
export function FilterBar({ options, show, currentFy }: { options: FilterOptionsLite; show: Show; currentFy: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const get = (k: string) => sp.get(k) ?? "";
  const push = (changes: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    next.delete("page");
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (!show.search) return;
    if ((sp.get("q") ?? "") === q) return;
    timer.current = setTimeout(() => push({ q }), 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const gstinOptions = useMemo(() => {
    const cs = get("client") ? options.clients.filter((c) => c.id === get("client")) : options.clients;
    return cs.flatMap((c) => c.gstins.map((g) => ({ ...g, client: c.name })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.clients, sp]);

  const monthOptions = options.months.filter((m) => m.fy === (get("fy") || currentFy));
  const active = ["client", "gstin", "period", "vendor", "status", "decision", "assignee", "q"].some((k) => sp.get(k)) || (sp.get("fy") && sp.get("fy") !== currentFy);

  return (
    <div className="mb-5 rounded-lg border bg-card p-3 shadow-sm">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {show.client && (
          <Select aria-label="Client" value={get("client")} onChange={(e) => push({ client: e.target.value, gstin: "" })}>
            <option value="">All clients</option>
            {options.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        {show.gstin && (
          <Select aria-label="GSTIN" value={get("gstin")} onChange={(e) => push({ gstin: e.target.value })}>
            <option value="">All GSTINs</option>
            {gstinOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.gstin}
                {g.tradeName ? ` · ${g.tradeName}` : ""}
              </option>
            ))}
          </Select>
        )}
        {show.fy && (
          <Select aria-label="Financial year" value={get("fy") || currentFy} onChange={(e) => push({ fy: e.target.value, period: "" })}>
            {options.fys.includes(currentFy) ? null : <option value={currentFy}>FY {currentFy}</option>}
            {options.fys.map((fy) => (
              <option key={fy} value={fy}>
                FY {fy}
              </option>
            ))}
          </Select>
        )}
        {show.period && (
          <Select aria-label="Month" value={get("period")} onChange={(e) => push({ period: e.target.value })}>
            <option value="">All months</option>
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {monthLabel(m.year, m.month)}
              </option>
            ))}
          </Select>
        )}
        {show.vendor && (
          <Select aria-label="Vendor" value={get("vendor")} onChange={(e) => push({ vendor: e.target.value })}>
            <option value="">All vendors</option>
            {options.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        )}
        {show.status && (
          <Select aria-label="Status" value={get("status")} onChange={(e) => push({ status: e.target.value })}>
            <option value="">All statuses</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </Select>
        )}
        {show.decision && (
          <Select aria-label="Decision" value={get("decision")} onChange={(e) => push({ decision: e.target.value })}>
            <option value="">Any decision</option>
            {Object.entries(DECISION_META).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </Select>
        )}
        {show.assignee && (
          <Select aria-label="Follow-up owner" value={get("assignee")} onChange={(e) => push({ assignee: e.target.value })}>
            <option value="">Any owner</option>
            <option value="none">Unassigned</option>
            {options.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        )}
        {show.search && (
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input aria-label="Search" className="pl-8" placeholder="Search invoice no., supplier or GSTIN" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
      </div>
      {active ? (
        <button
          type="button"
          onClick={() => {
            setQ("");
            router.replace(pathname, { scroll: false });
          }}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <X className="size-3" /> Clear filters
        </button>
      ) : null}
    </div>
  );
}
