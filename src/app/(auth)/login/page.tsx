import type { Metadata } from "next";
import { Suspense } from "react";
import { signupOpen } from "@/lib/signup";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  return (
    <Suspense>
      <LoginForm signupOpen={await signupOpen()} />
    </Suspense>
  );
}
