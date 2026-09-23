"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const body = { organizationName: f.get("organizationName"), name: f.get("name"), email: f.get("email"), password: f.get("password") };
    const res = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not create the account.");
      setBusy(false);
      return;
    }
    await signIn("credentials", { email: body.email, password: body.password, redirect: false });
    router.push("/clients");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-lg font-semibold">Create your organisation</h1>
      <div>
        <Label htmlFor="organizationName">Firm / company name</Label>
        <Input id="organizationName" name="organizationName" required minLength={2} autoFocus />
      </div>
      <div>
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" autoComplete="name" required minLength={2} />
      </div>
      <div>
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
        <p className="field-hint">At least 10 characters, with a letter and a number.</p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Creating…" : "Create organisation"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
