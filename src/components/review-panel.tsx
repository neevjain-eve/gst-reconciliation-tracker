"use client";

import { Check, CircleSlash, Flag, Eye, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DECISION_META } from "@/lib/constants";
import type { DecisionStr } from "@/lib/constants-types";
import { cn } from "@/lib/utils";

interface Props {
  resultId: string;
  decision: DecisionStr;
  assigneeId: string | null;
  followUpDueDate: string | null; // YYYY-MM-DD
  users: { id: string; name: string }[];
}

const ACTIONS: { value: DecisionStr; icon: typeof Check; hint: string }[] = [
  { value: "ACCEPTED", icon: Check, hint: "Counts the ITC as matched" },
  { value: "REJECTED", icon: CircleSlash, hint: "Excludes the ITC from matched" },
  { value: "REVIEWED", icon: Eye, hint: "Looked at, no change to totals" },
  { value: "FOLLOW_UP", icon: Flag, hint: "Needs action from someone" },
  { value: "PENDING", icon: RotateCcw, hint: "Clear the decision" },
];

async function call(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as { error?: string } };
}

export function ReviewPanel({ resultId, decision, assigneeId, followUpDueDate, users }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [owner, setOwner] = useState(assigneeId ?? "");
  const [due, setDue] = useState(followUpDueDate ?? "");

  async function decide(next: DecisionStr) {
    setBusy(true);
    const r = await call(`/api/reconciliation/${resultId}`, "PATCH", { decision: next, note: note.trim() || undefined });
    setBusy(false);
    if (!r.ok) return toast.error(r.data.error ?? "Could not save.");
    setNote("");
    toast.success(`Marked ${DECISION_META[next].label.toLowerCase()}`);
    router.refresh();
  }

  async function saveFollowUp() {
    setBusy(true);
    const r = await call(`/api/reconciliation/${resultId}`, "PATCH", { assigneeId: owner || null, followUpDueDate: due || null });
    setBusy(false);
    if (!r.ok) return toast.error(r.data.error ?? "Could not save.");
    toast.success("Follow-up details saved");
    router.refresh();
  }

  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    const r = await call(`/api/reconciliation/${resultId}/comments`, "POST", { body: note.trim(), kind: decision === "FOLLOW_UP" ? "FOLLOW_UP" : "NOTE" });
    setBusy(false);
    if (!r.ok) return toast.error(r.data.error ?? "Could not add the note.");
    setNote("");
    toast.success("Note added");
    router.refresh();
  }

  const dirty = owner !== (assigneeId ?? "") || due !== (followUpDueDate ?? "");

  return (
    <div className="space-y-5">
      <div>
        <Label>Decision</Label>
        <div role="group" aria-label="Decision" className="grid grid-cols-2 gap-2">
          {ACTIONS.map(({ value, icon: Icon, hint }) => {
            const active = decision === value;
            return (
              <button
                key={value}
                type="button"
                disabled={busy}
                aria-pressed={active}
                title={hint}
                onClick={() => (active ? undefined : decide(value))}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors disabled:opacity-60",
                  value === "PENDING" && "col-span-2 justify-center text-muted-foreground",
                  active ? "border-primary bg-primary/5 text-primary ring-1 ring-primary" : "hover:bg-accent",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {value === "PENDING" ? "Reset to pending" : DECISION_META[value].label}
              </button>
            );
          })}
        </div>
        <p className="field-hint">Decisions are stored separately from the imported documents and survive re-running reconciliation.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="rp-owner">Follow-up owner</Label>
          <Select id="rp-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="rp-due">Due date</Label>
          <Input id="rp-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        {dirty ? (
          <div className="sm:col-span-2">
            <Button size="sm" onClick={saveFollowUp} disabled={busy}>
              Save owner &amp; due date
            </Button>
          </div>
        ) : null}
      </div>

      <div>
        <Label htmlFor="rp-note">Note</Label>
        <Textarea id="rp-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called supplier – they will file the invoice in next month’s GSTR-1." />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={addNote} disabled={busy || !note.trim()}>
            Add note
          </Button>
          <p className="self-center text-xs text-muted-foreground">Or press a decision above to save the note together with it.</p>
        </div>
      </div>
    </div>
  );
}
