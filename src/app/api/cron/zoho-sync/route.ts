import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { syncZohoConnection } from "@/lib/zoho/sync";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Scheduled sync (vercel.json → crons). Vercel sends `Authorization: Bearer $CRON_SECRET`.
 * Connections are processed least-recently-synced first, within the function time limit; the rest wait for the next run.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const conns = await prisma.zohoConnection.findMany({
    where: { status: "ACTIVE", autoSync: true, zohoOrganizationId: { not: null } },
    orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }],
    select: { id: true, organizationId: true },
    take: 50,
  });

  const results: { id: string; ok: boolean; imported?: number; remaining?: number; error?: string }[] = [];
  for (const c of conns) {
    const left = 55_000 - (Date.now() - started);
    if (left < 12_000) break;
    try {
      const r = await syncZohoConnection(c.id, c.organizationId, { userId: null, budgetMs: Math.min(30_000, left - 10_000) });
      results.push({ id: c.id, ok: true, imported: r.imported, remaining: r.remaining });
    } catch (e) {
      results.push({ id: c.id, ok: false, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return NextResponse.json({ processed: results.length, pending: conns.length - results.length, results });
}
