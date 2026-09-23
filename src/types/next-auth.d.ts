import "next-auth";
import "next-auth/jwt";

type AppRole = "OWNER" | "ADMIN" | "MEMBER";

declare module "next-auth" {
  interface Session {
    user: { id: string; orgId: string; role: AppRole; name?: string | null; email?: string | null };
  }
  interface User {
    id: string;
    orgId: string;
    role: AppRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    orgId?: string;
    role?: AppRole;
  }
}
