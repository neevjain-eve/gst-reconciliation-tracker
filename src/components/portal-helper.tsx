"use client";

import { Bookmark, Check, Copy, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { buildBookmarklet } from "@/lib/gst-portal-bookmarklet";
import { cn } from "@/lib/utils";

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Add the helper to your bookmarks bar (one time)",
    body: (
      <>
        Show the bookmarks bar (<kbd className="rounded border px-1 text-[11px]">⌘/Ctrl</kbd> + <kbd className="rounded border px-1 text-[11px]">Shift</kbd> + <kbd className="rounded border px-1 text-[11px]">B</kbd>), then drag the
        orange <b>GSTR-2B helper</b> button above onto it.
      </>
    ),
  },
  {
    title: "Log in to the GST portal yourself",
    body: (
      <>
        Go to{" "}
        <a className="font-medium underline" href="https://services.gst.gov.in/services/login" target="_blank" rel="noreferrer noopener">
          gst.gov.in
        </a>{" "}
        and log in as you normally do – username, password and captcha are entered by you. The helper refuses to run on the login page.
      </>
    ),
  },
  {
    title: "Click the bookmark – it opens your Returns Dashboard",
    body: <>Click it again once the dashboard loads. Type the month you want (e.g. 08-2026); it picks the financial year, quarter and month, presses Search and opens the GSTR-2B tile.</>,
  },
  {
    title: "Click the bookmark once more on the GSTR-2B page",
    body: <>It asks the portal to generate the Excel file and clicks the download link when it appears. The file lands in your Downloads folder.</>,
  },
  {
    title: "Upload it here",
    body: (
      <>
        Open{" "}
        <Link className="font-medium underline" href="/sources/upload">
          Upload files
        </Link>
        , choose <b>GSTR-2B</b> and drop the file in as it is – the portal Excel and JSON formats are read directly.
      </>
    ),
  },
];

export function PortalHelper() {
  const href = useMemo(() => buildBookmarklet(), []);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);

  // React blocks javascript: URLs in JSX, so the bookmarklet URL is set on the DOM node directly.
  useEffect(() => {
    linkRef.current?.setAttribute("href", href);
  }, [href]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      toast.success("Copied. Create a new bookmark and paste this as its URL.");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy – drag the button to your bookmarks bar instead.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="space-y-5 rounded-lg border bg-card p-5 shadow-sm">
        <div>
          <h2 className="text-base font-semibold">GSTR-2B download helper</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A bookmark that does the clicking on the GST portal for you, after you&apos;ve logged in, so getting a month&apos;s GSTR-2B takes a few seconds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-4">
          <a
            ref={linkRef}
            href="#"
            draggable
            onClick={(e) => {
              e.preventDefault();
              toast.info("Drag this button onto your bookmarks bar – then click it on the GST portal.");
            }}
            className={cn(buttonVariants(), "cursor-grab bg-orange-500 text-white hover:bg-orange-600 active:cursor-grabbing")}
          >
            <Bookmark /> GSTR-2B helper
          </a>
          <span className="text-xs text-muted-foreground">← drag to your bookmarks bar</span>
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={copy}>
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy bookmark code"}
          </Button>
        </div>

        <ol className="space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
              <div>
                <p className="text-sm font-medium">{s.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <aside className="space-y-4">
        <div className="rounded-lg border bg-card p-5 text-sm shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-green-600" /> What it will and won&apos;t do
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li>Runs only when you click it, only on gst.gov.in, inside your own browser.</li>
            <li>Never reads, fills or submits your username, password or captcha – you log in yourself.</li>
            <li>Sends nothing anywhere: no data leaves the portal page, and this app never sees your portal session.</li>
            <li>Only selects the period, presses Search / Download / Generate Excel – the same buttons you would.</li>
          </ul>
        </div>
        <div className="rounded-lg border bg-card p-5 text-sm shadow-sm">
          <h3 className="text-sm font-semibold">If the portal changes</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            The GST portal redesigns its pages from time to time. If the helper can&apos;t find a dropdown or button it stops and tells you what to click, so you can always finish by hand:
            Returns Dashboard → choose year and month → Search → GSTR-2B → Download → Generate Excel file.
          </p>
        </div>
      </aside>
    </div>
  );
}
