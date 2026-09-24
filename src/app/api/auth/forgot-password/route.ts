import { randomBytes, createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { forgotPasswordSchema } from "@/lib/schemas";
import { errorResponse } from "@/lib/api";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Starts a password reset. Always responds the same way regardless of whether the email
 * exists, so this can't be used to enumerate accounts. No email provider is configured for
 * this deployment yet, so the reset link is written to the server logs (Vercel → this
 * project → Logs) rather than emailed — an administrator with access to those logs retrieves
 * it and passes it to whoever asked. The raw token itself is never stored, only its hash.
 */
export async function POST(req: NextRequest) {
  try {
    const { email } = forgotPasswordSchema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isActive: true } });

    if (user?.isActive) {
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
      });

      const origin = req.headers.get("origin") ?? new URL(req.url).origin;
      const resetUrl = `${origin}/reset-password?token=${rawToken}`;
      console.log(`[password-reset] ${email} -> ${resetUrl} (expires in 1 hour)`);
    }

    return NextResponse.json({ ok: true, message: "If that email has an account, a reset link has been generated." });
  } catch (e) {
    return errorResponse(e);
  }
}
