export { default } from "next-auth/middleware";

// Pages that require a signed-in user. API routes authenticate themselves (see src/lib/api.ts).
export const config = {
  matcher: ["/dashboard/:path*", "/clients/:path*", "/sources/:path*", "/reconciliation/:path*", "/reports/:path*", "/audit/:path*", "/settings/:path*"],
};
