import { apiRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { commentSchema } from "@/lib/schemas";
import { ApiError } from "@/lib/session";

export const POST = apiRoute<{ id: string }>(async (req, ctx, { id }) => {
  const input = await parseJson(req, commentSchema);
  const result = await prisma.reconciliationResult.findFirst({ where: { id, organizationId: ctx.orgId }, select: { id: true, invoiceNumber: true, supplierGstin: true } });
  if (!result) throw new ApiError(404, "Result not found");
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.comment.create({ data: { organizationId: ctx.orgId, resultId: id, authorId: ctx.userId, kind: input.kind, body: input.body } });
    await audit(tx, ctx, {
      action: "COMMENT_ADDED",
      entityType: "ReconciliationResult",
      entityId: id,
      summary: `${input.kind === "FOLLOW_UP" ? "Follow-up" : "Note"} added on ${result.invoiceNumber} (${result.supplierGstin})`,
      metadata: { commentId: c.id },
    });
    return c;
  });
  return { id: comment.id };
});
