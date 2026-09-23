import { apiRoute } from "@/lib/api";
import { importUploadedFile } from "@/lib/import/run";
import { UploadError, uploadLimits } from "@/lib/import/parse-file";
import { uploadMetaSchema } from "@/lib/schemas";

export const maxDuration = 60;

/** multipart/form-data: file, type (BOOKS|GSTR2B), gstinRegistrationId, period (YYYY-MM, GSTR-2B), replace, strict */
export const POST = apiRoute(async (req, ctx) => {
  const limits = uploadLimits();
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > limits.maxBytes + 512 * 1024) throw new UploadError(`File is too large (limit ${limits.maxBytes / 1024 / 1024} MB).`, 413);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new UploadError("Choose a file to upload.");
  if (file.size === 0) throw new UploadError("The file is empty.");
  if (file.size > limits.maxBytes) throw new UploadError(`File is too large (limit ${limits.maxBytes / 1024 / 1024} MB).`, 413);

  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const meta = uploadMetaSchema.parse({
    type: str("type"),
    gstinRegistrationId: str("gstinRegistrationId"),
    period: str("period"),
    replace: str("replace"),
    strict: str("strict"),
  });
  const period = meta.period ? { year: Number(meta.period.slice(0, 4)), month: Number(meta.period.slice(5, 7)) } : undefined;

  return importUploadedFile(ctx, {
    type: meta.type,
    gstinRegistrationId: meta.gstinRegistrationId,
    file: { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) },
    period,
    replace: meta.replace,
    strict: meta.strict,
  });
});
