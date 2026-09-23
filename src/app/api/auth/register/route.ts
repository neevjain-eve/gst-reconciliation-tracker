import bcrypt from "bcryptjs";
import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { registerSchema } from "@/lib/schemas";
import { signupOpen } from "@/lib/signup";
import { ApiError } from "@/lib/session";

/** Creates a new organisation with its first (OWNER) user. Only the first account may register unless ALLOW_SIGNUP=true (see src/lib/signup.ts). */
export async function POST(req: NextRequest) {
  try {
    const input = registerSchema.parse(await req.json());
    if (!(await signupOpen())) {
      throw new ApiError(403, "Sign-up is disabled. Ask your administrator to add you to the organisation.");
    }
    if (await prisma.user.findUnique({ where: { email: input.email } })) throw new ApiError(409, "An account with this email already exists");

    const passwordHash = await bcrypt.hash(input.password, 12);
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: input.organizationName } });
      const user = await tx.user.create({ data: { organizationId: org.id, email: input.email, name: input.name, passwordHash, role: "OWNER" } });
      await audit(tx, { orgId: org.id, userId: user.id }, { action: "ORG_CREATED", entityType: "Organization", entityId: org.id, summary: `Organisation “${org.name}” created` });
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
