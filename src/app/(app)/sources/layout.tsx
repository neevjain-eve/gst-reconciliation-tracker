import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { SourceTabs } from "@/components/source-tabs";

export default function SourcesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="Data sources" description="Bring purchase bills and GSTR-2B into the tracker. Imported data is never edited – corrections arrive as new versions." />
      <SourceTabs />
      {children}
    </>
  );
}
