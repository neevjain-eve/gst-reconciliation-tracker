import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { resetPasswordSchema } from "@/lib/schemas";
import { ApiError } from "@/lib/session";
import { errorResponse } from "@/lib/api";

/** Completes a password reset: validates the (unexpired, unused) token and sets a new password. */
export async function POST(req: NextRequest) {
  try {
    const { token, password } = resetPasswordSchema.parse(await req.json());
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, organizationId: true, isActive: true } } },
    });

    if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.isActive) {
      throw new ApiError(400, "This reset link is invalid or has expired. Request a new one.");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      // Invalidate any other outstanding reset tokens for this user.
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: new Date() },
      });
      await audit(tx, { orgId: record.user.organizationId, userId: record.userId }, {
        action: "PASSWORD_RESET",
        entityType: "User",
        entityId: record.userId,
        summary: "Password reset via forgot-password link",
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
