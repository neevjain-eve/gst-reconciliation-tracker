import { z } from "zod";
import { isValidFinancialYear, parseDateInput, validateInvoiceDate } from "./dates";
import { isValidGstin, normalizeGstin } from "./gstin";
import { validateAmounts } from "./money";

export const gstinSchema = z
  .string({ required_error: "GSTIN is required" })
  .transform(normalizeGstin)
  .refine(isValidGstin, "Invalid GSTIN – check the format and check digit");

const money = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number` })
    .finite()
    .min(0, `${label} cannot be negative`)
    .max(100_000_000_000, `${label} is implausibly large`);

const optionalMoney = (label: string) => z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : v), money(label));

export const dateSchema = z
  .string({ required_error: "Date is required" })
  .transform((s, ctx) => {
    const d = parseDateInput(s);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date (DD-MM-YYYY or YYYY-MM-DD)" });
      return z.NEVER;
    }
    return d;
  });

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2, "Organisation name is required").max(120),
  name: z.string().trim().min(2, "Your name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(128)
    .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Include at least one letter and one number"),
});

export const teamMemberSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: registerSchema.shape.password,
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export const clientCreateSchema = z.object({
  name: z.string().trim().min(2, "Client name is required").max(150),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like ABCDE1234F")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  gstin: gstinSchema,
  tradeName: z.string().trim().max(150).optional(),
});

export const gstinCreateSchema = z.object({
  clientId: z.string().min(1),
  gstin: gstinSchema,
  tradeName: z.string().trim().max(150).optional(),
});

export const periodsCreateSchema = z.object({
  gstinRegistrationId: z.string().min(1),
  financialYear: z.string().refine(isValidFinancialYear, "Financial year must look like 2025-26"),
});

export const periodStatusSchema = z.object({ status: z.enum(["OPEN", "IN_REVIEW", "CLOSED"]) });

export const manualInvoiceSchema = z
  .object({
    gstinRegistrationId: z.string().min(1, "Choose the client GSTIN"),
    docType: z.enum(["INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"]).default("INVOICE"),
    supplierGstin: gstinSchema,
    supplierName: z.string().trim().min(2, "Supplier name is required").max(150),
    invoiceNumber: z.string().trim().min(1, "Invoice number is required").max(50, "Invoice number is too long"),
    invoiceDate: dateSchema,
    placeOfSupply: z.string().trim().max(60).optional(),
    reverseCharge: z.boolean().default(false),
    itcEligible: z.boolean().default(true),
    taxableValue: money("Taxable value"),
    igst: optionalMoney("IGST"),
    cgst: optionalMoney("CGST"),
    sgst: optionalMoney("SGST"),
    cess: optionalMoney("Cess"),
    invoiceValue: z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), money("Invoice value").optional()),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    const dateErr = validateInvoiceDate(v.invoiceDate);
    if (dateErr) ctx.addIssue({ code: "custom", path: ["invoiceDate"], message: dateErr });
    const { errors } = validateAmounts(v);
    errors.forEach((message) => ctx.addIssue({ code: "custom", path: ["igst"], message }));
  });

export const runSchema = z.object({
  gstinRegistrationId: z.string().min(1),
  financialYear: z.string().refine(isValidFinancialYear, "Financial year must look like 2025-26"),
  options: z
    .object({
      roundingTolerance: z.coerce.number().min(0).max(100).optional(),
      varianceTolerance: z.coerce.number().min(0).max(100000).optional(),
    })
    .optional(),
});

export const resultUpdateSchema = z.object({
  decision: z.enum(["PENDING", "ACCEPTED", "REJECTED", "REVIEWED", "FOLLOW_UP"]).optional(),
  assigneeId: z.string().nullable().optional(),
  followUpDueDate: z
    .string()
    .nullable()
    .optional()
    .transform((s, ctx) => {
      if (s === null || s === undefined || s === "") return s === null || s === "" ? null : undefined;
      const d = parseDateInput(s);
      if (!d) {
        ctx.addIssue({ code: "custom", message: "Invalid follow-up date" });
        return z.NEVER;
      }
      return d;
    }),
  note: z.string().trim().max(2000).optional(),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1, "Write a note first").max(2000),
  kind: z.enum(["NOTE", "FOLLOW_UP"]).default("NOTE"),
});

export const uploadMetaSchema = z.object({
  type: z.enum(["BOOKS", "GSTR2B"]),
  gstinRegistrationId: z.string().min(1, "Choose the client GSTIN"),
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must look like 2025-04")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  replace: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
  strict: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const gspFetchSchema = z.object({
  gstinRegistrationId: z.string().min(1, "Choose the client GSTIN"),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must look like 2025-04"),
});

const zohoDcSchema = z.enum(["in", "com", "eu", "com.au", "jp", "ca", "sa", "com.cn"]);
export const zohoConnectSchema = z.object({ gstinRegistrationId: z.string().min(1), dc: zohoDcSchema });
export const zohoRegSchema = z.object({ gstinRegistrationId: z.string().min(1) });
export const zohoSelectOrgSchema = z.object({ gstinRegistrationId: z.string().min(1), zohoOrganizationId: z.string().min(1).max(40) });
export const zohoSyncSchema = z.object({ gstinRegistrationId: z.string().min(1), full: z.boolean().optional() });
export const zohoSettingsSchema = z.object({
  gstinRegistrationId: z.string().min(1),
  autoSync: z.boolean().optional(),
  syncFromDate: z
    .string()
    .nullable()
    .optional()
    .transform((s, ctx) => {
      if (s === undefined) return undefined;
      if (s === null || s === "") return null;
      const d = parseDateInput(s);
      if (!d) {
        ctx.addIssue({ code: "custom", message: "Enter a valid date" });
        return z.NEVER;
      }
      return d;
    }),
});
