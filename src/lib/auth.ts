import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./db";

// Compared against when the user does not exist so response time does not reveal valid emails.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO5KzPzY7mYgD0Zl5m0yJf3FvQyq5X6Wq";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password ?? "";
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !ok || !user.isActive) return null;
        return { id: user.id, name: user.name, email: user.email, orgId: user.organizationId, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.orgId = user.orgId;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.uid as string;
      session.user.orgId = token.orgId as string;
      session.user.role = token.role ?? "MEMBER";
      return session;
    },
  },
};
