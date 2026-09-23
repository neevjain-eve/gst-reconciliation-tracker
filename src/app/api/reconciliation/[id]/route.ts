import { apiRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { toISODate } from "@/lib/dates";
import { resultUpdateSchema } from "@/lib/schemas";
import { ApiError } from "@/lib/session";

/** Record a reconciliation decision / follow-up owner / note. Never touches the imported documents. */
export const PATCH = apiRoute<{ id: string }>(async (req, ctx, { id }) => {
  const input = await parseJson(req, resultUpdateSchema);
  const result = await prisma.reconciliationResult.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!result) throw new ApiError(404, "Result not found");

  if (input.assigneeId) {
    const u = await prisma.user.findFirst({ where: { id: input.assigneeId, organizationId: ctx.orgId, isActive: true } });
    if (!u) throw new ApiError(400, "Assignee is not a member of this organisation");
  }

  const before = { decision: result.decision, assigneeId: result.assigneeId, followUpDueDate: result.followUpDueDate ? toISODate(result.followUpDueDate) : null };
  const data: Record<string, unknown> = {};
  if (input.decision !== undefined && input.decision !== result.decision) {
    data.decision = input.decision;
    data.decidedById = input.decision === "PENDING" ? null : ctx.userId;
    data.decidedAt = input.decision === "PENDING" ? null : new Date();
  }
  if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;
  if (input.followUpDueDate !== undefined) data.followUpDueDate = input.followUpDueDate;

  const updated = await prisma.$transaction(async (tx) => {
    const r = Object.keys(data).length ? await tx.reconciliationResult.update({ where: { id }, data }) : result;
    if (input.note) {
      await tx.comment.create({
        data: {
          organizationId: ctx.orgId,
          resultId: id,
          authorId: ctx.userId,
          kind: (input.decision ?? r.decision) === "FOLLOW_UP" ? "FOLLOW_UP" : "NOTE",
          body: input.note,
          dueDate: r.followUpDueDate,
        },
      });
    }
    const after = { decision: r.decision, assigneeId: r.assigneeId, followUpDueDate: r.followUpDueDate ? toISODate(r.followUpDueDate) : null };
    if (Object.keys(data).length || input.note) {
      await audit(tx, ctx, {
        action: "RESULT_UPDATED",
        entityType: "ReconciliationResult",
        entityId: id,
        summary: `${result.invoiceNumber} (${result.supplierGstin}): ${
          input.decision && input.decision !== result.decision ? `${result.decision} → ${input.decision}` : "details updated"
        }${input.note ? " · note added" : ""}`,
        before,
        after,
        metadata: input.note ? { note: input.note } : undefined,
      });
    }
    return r;
  });
  return { id: updated.id, decision: updated.decision, assigneeId: updated.assigneeId };
});
