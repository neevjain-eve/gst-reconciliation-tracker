import type { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authOptions } from "./auth";
import { prisma } from "./db";

export interface Ctx {
  userId: string;
  orgId: string;
  role: Role;
  email: string;
  name: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/**
 * Resolve the signed-in user from the session cookie and re-check the database, so a deactivated
 * user loses access immediately instead of when the JWT expires. Deduplicated per request.
 */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, isActive: true, organizationId: true },
  });
  if (!user || !user.isActive) return null;
  return { userId: user.id, orgId: user.organizationId, role: user.role, email: user.email, name: user.name };
});

/** For server components / pages: redirect to the login screen when signed out. */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

/** For route handlers: throw a 401 the API wrapper turns into JSON. */
export async function apiCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new ApiError(401, "Not signed in");
  return ctx;
}

export function requireRole(ctx: Ctx, ...roles: Role[]) {
  if (!roles.includes(ctx.role)) throw new ApiError(403, "You do not have permission to do this");
}
