import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";

type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

/**
 * Append-only audit trail. Pass a transaction client to make the log entry atomic with the change it describes.
 * Never store secrets (tokens, passwords) in before/after/metadata.
 */
export async function audit(db: Db | null, who: { orgId: string; userId?: string | null }, e: AuditEntry) {
  const client = db ?? prisma;
  await client.auditLog.create({
    data: {
      organizationId: who.orgId,
      userId: who.userId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      summary: e.summary,
      before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (e.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
