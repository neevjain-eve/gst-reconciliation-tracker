import bcrypt from "bcryptjs";
import { apiRoute, parseJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { teamMemberSchema } from "@/lib/schemas";
import { ApiError, requireRole } from "@/lib/session";

export const POST = apiRoute(async (req, ctx) => {
  requireRole(ctx, "OWNER", "ADMIN");
  const input = await parseJson(req, teamMemberSchema);
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw new ApiError(409, "A user with this email already exists");
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { organizationId: ctx.orgId, email: input.email, name: input.name, passwordHash, role: input.role } });
    await audit(tx, ctx, { action: "USER_ADDED", entityType: "User", entityId: u.id, summary: `Added ${u.name} (${u.email}) as ${u.role}` });
    return u;
  });
  return { id: user.id, email: user.email, name: user.name, role: user.role };
});
