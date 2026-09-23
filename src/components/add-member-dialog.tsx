"use client";

import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AddMemberDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: f.get("name"), email: f.get("email"), password: f.get("password"), role: f.get("role") }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not add the user.");
    toast.success("Team member added");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus /> Add member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add team member</DialogTitle>
          <DialogDescription>They will see the same clients and data as everyone in your organisation. Share the temporary password securely.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="m-name">Name</Label>
            <Input id="m-name" name="name" required minLength={2} maxLength={100} autoFocus />
          </div>
          <div>
            <Label htmlFor="m-email">Email</Label>
            <Input id="m-email" name="email" type="email" required autoComplete="off" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="m-pw">Temporary password</Label>
              <Input id="m-pw" name="password" type="password" required minLength={10} autoComplete="new-password" />
              <p className="field-hint">10+ characters, letters and numbers.</p>
            </div>
            <div>
              <Label htmlFor="m-role">Role</Label>
              <Select id="m-role" name="role" defaultValue="MEMBER">
                <option value="MEMBER">Member – review &amp; import</option>
                <option value="ADMIN">Admin – also manage integrations &amp; team</option>
              </Select>
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add member"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
