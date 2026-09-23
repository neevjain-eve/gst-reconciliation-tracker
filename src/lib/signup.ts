import { prisma } from "./db";

/**
 * Who may create an organisation?
 *  • The very first account on a fresh install – always (bootstrap).
 *  • Afterwards only when ALLOW_SIGNUP="true" (self-serve, multi-organisation hosting).
 * The safe default for a firm's own deployment is therefore "closed once set up"; admins add colleagues under Settings.
 */
export async function signupOpen(): Promise<boolean> {
  if (process.env.ALLOW_SIGNUP === "true") return true;
  return (await prisma.user.count()) === 0;
}
