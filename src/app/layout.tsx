import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GST Reconciliation Tracker", template: "%s · GST Recon" },
  description: "Reconcile purchase bills from Zoho Books, manual entries and uploads against GSTR-2B.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
