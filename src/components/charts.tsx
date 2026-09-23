import Link from "next/link";
import { STATUS_META, STATUS_ORDER } from "@/lib/constants";
import type { ReconStatusStr } from "@/lib/constants-types";
import { cn, formatINR, formatINRCompact } from "@/lib/utils";

/** Horizontal count bars per reconciliation status. Each row is a link to the pre-filtered tracker. */
export function StatusBars({ counts, hrefFor }: { counts: Partial<Record<ReconStatusStr, number>>; hrefFor: (s: ReconStatusStr) => string }) {
  const max = Math.max(1, ...Object.values(counts).map((c) => c ?? 0));
  return (
    <ul className="space-y-1.5">
      {STATUS_ORDER.map((s) => {
        const n = counts[s] ?? 0;
        const m = STATUS_META[s];
        return (
          <li key={s}>
            <Link href={hrefFor(s)} className="group grid grid-cols-[minmax(0,13rem)_1fr_3.25rem] items-center gap-3 rounded-md px-1.5 py-1 hover:bg-muted/60" title={m.hint}>
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: m.dot }} />
                <span className="truncate">{m.label}</span>
              </span>
              <span className="h-2.5 rounded-full bg-muted" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${(n / max) * 100}%`, background: m.dot, minWidth: n ? 4 : 0 }} />
              </span>
              <span className={cn("tnum text-right text-sm font-medium", n === 0 && "text-muted-foreground")}>{n.toLocaleString("en-IN")}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function niceScale(max: number) {
  if (max <= 0) return { top: 1, step: 0.25 };
  const raw = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * pow;
  return { top: Math.ceil(max / step) * step, step };
}

interface MonthPoint {
  key: string;
  label: string;
  books: number;
  gstr2b: number;
  matched: number;
}

const SERIES = [
  { key: "books", label: "ITC in books", color: "var(--series-1)" },
  { key: "gstr2b", label: "ITC in GSTR-2B", color: "var(--series-2)" },
  { key: "matched", label: "Matched ITC", color: "var(--series-3)" },
] as const;

/** Grouped bars: books vs GSTR-2B vs matched ITC per month. A data table is provided for screen readers and low-contrast series. */
export function MonthlyChart({ data }: { data: MonthPoint[] }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-muted-foreground">No monthly data yet.</p>;
  const W = 720;
  const H = 260;
  const pad = { l: 56, r: 8, t: 10, b: 30 };
  const max = Math.max(...data.flatMap((d) => [d.books, d.gstr2b, d.matched]), 0);
  const { top, step } = niceScale(max);
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const groupW = plotW / data.length;
  const barW = Math.min(16, (groupW - 8) / 3);
  const y = (v: number) => pad.t + plotH - (Math.max(v, 0) / top) * plotH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Monthly ITC in books, in GSTR-2B and matched">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--viz-axis)" className="tnum">
              {formatINRCompact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = pad.l + i * groupW + (groupW - (barW * 3 + 4)) / 2;
          return (
            <g key={d.key}>
              {SERIES.map((s, si) => {
                const v = d[s.key];
                const h = plotH - (y(v) - pad.t);
                return (
                  <rect key={s.key} x={x0 + si * (barW + 2)} y={y(v)} width={barW} height={Math.max(h, v > 0 ? 1 : 0)} rx={2} fill={s.color} className="opacity-95 hover:opacity-100">
                    <title>{`${d.label} · ${s.label}: ${formatINR(v)}`}</title>
                  </rect>
                );
              })}
              <text x={pad.l + i * groupW + groupW / 2} y={H - 10} textAnchor="middle" fontSize={11} fill="var(--viz-axis)">
                {d.label.replace(/ \d{4}$/, "")}
              </text>
            </g>
          );
        })}
      </svg>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View as table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-right">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Month</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-1 font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.key} className="border-t">
                  <td className="py-1 text-left">{d.label}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="tnum py-1">
                      {formatINR(d[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
