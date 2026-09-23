import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiRoute, parseQuery } from "@/lib/api";
import { templateCsv, templateXlsx } from "@/lib/import/templates";

const querySchema = z.object({ type: z.enum(["books", "gstr2b"]), format: z.enum(["csv", "xlsx"]).default("xlsx") });

export const GET = apiRoute(async (req: NextRequest) => {
  const { type, format } = parseQuery(req, querySchema);
  const name = `gst-recon-${type}-template.${format}`;
  if (format === "csv") {
    return new NextResponse(templateCsv(type), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
    });
  }
  const buf = await templateXlsx(type);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
});
