import { apiRoute, parseJson } from "@/lib/api";
import { sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { GspError } from "@/lib/gsp/types";
import { getProvider } from "@/lib/gsp/registry";
import { parseGstr2bJson } from "@/lib/import/gstr2b-json";
import { getRegistration, persistImport } from "@/lib/import/run";
import { UploadError } from "@/lib/import/parse-file";
import { gspFetchSchema } from "@/lib/schemas";
import { ApiError } from "@/lib/session";

export const maxDuration = 60;

/**
 * Pull one month of GSTR-2B through the configured, authorised GSP and import it exactly like an uploaded
 * file (immutable rows, replace-period semantics, audit trail). No GST portal credentials are involved.
 */
export const POST = apiRoute(async (req, ctx) => {
  const body = await parseJson(req, gspFetchSchema);
  const provider = getProvider();
  if (!provider || !provider.isConfigured()) throw new ApiError(400, "No GSTR-2B API provider is configured. Upload the GSTR-2B file instead.");

  const year = Number(body.period.slice(0, 4));
  const month = Number(body.period.slice(5, 7));
  const now = new Date();
  if (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)) throw new ApiError(400, "That return period is in the future.");

  const reg = await getRegistration(ctx.orgId, body.gstinRegistrationId);

  // GSP calls can be metered – refuse rapid repeats for the same GSTIN.
  const recent = await prisma.importJob.findFirst({
    where: { organizationId: ctx.orgId, gstinRegistrationId: reg.id, type: "GSP_FETCH", startedAt: { gt: new Date(Date.now() - 60_000) } },
    select: { id: true },
  });
  if (recent) throw new ApiError(429, "A GSTR-2B fetch for this GSTIN just ran. Wait a minute before fetching again.");

  let doc: unknown;
  try {
    doc = await provider.fetchGstr2b({ gstin: reg.gstin, year, month });
  } catch (e) {
    if (e instanceof GspError) throw new ApiError(e.status >= 400 && e.status < 600 ? e.status : 502, e.message);
    console.error("[gsp] provider failure", provider.id, e);
    throw new ApiError(502, "The GSTR-2B provider failed. Try again, or upload the file instead.");
  }

  const outcome = parseGstr2bJson(doc);
  if (outcome.gstin && outcome.gstin !== reg.gstin) throw new UploadError(`The provider returned data for ${outcome.gstin}, not ${reg.gstin}. Nothing was imported.`);
  if (outcome.returnPeriod && (outcome.returnPeriod.year !== year || outcome.returnPeriod.month !== month)) {
    throw new UploadError("The provider returned a different return period than requested. Nothing was imported.");
  }

  return persistImport({
    orgId: ctx.orgId,
    userId: ctx.userId,
    gstinRegistrationId: reg.id,
    kind: "GSTR2B",
    type: "GSP_FETCH",
    fileName: `${provider.id}:${reg.gstin}:${body.period}`,
    fileHash: sha256(Buffer.from(JSON.stringify(doc))),
    outcome,
    gstr2bSource: "GSP",
    period: { year, month },
    replace: true,
    meta: { provider: provider.id },
  });
});
