-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('ZOHO_BOOKS', 'MANUAL', 'FILE_UPLOAD');

-- CreateEnum
CREATE TYPE "Gstr2bSource" AS ENUM ('FILE_UPLOAD', 'GSP');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReconStatus" AS ENUM ('MATCHED', 'MATCHED_WITH_VARIANCE', 'MISSING_IN_GSTR2B', 'MISSING_IN_BOOKS', 'DUPLICATE_INVOICE', 'GSTIN_MISMATCH', 'INVOICE_NUMBER_MISMATCH', 'TAX_MISMATCH', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('EXACT', 'NORMALIZED', 'FUZZY', 'NONE');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'REVIEWED', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('BOOKS_FILE', 'GSTR2B_FILE', 'ZOHO_SYNC', 'GSP_FETCH');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');

-- CreateEnum
CREATE TYPE "ZohoStatus" AS ENUM ('PENDING_ORG_SELECTION', 'ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "CommentKind" AS ENUM ('NOTE', 'FOLLOW_UP');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pan" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstinRegistration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "tradeName" TEXT,
    "stateCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GstinRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gstinRegistrationId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pan" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gstinRegistrationId" TEXT NOT NULL,
    "taxPeriodId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "source" "InvoiceSource" NOT NULL,
    "externalId" TEXT,
    "externalModifiedAt" TEXT,
    "importJobId" TEXT,
    "createdById" TEXT,
    "docType" "DocType" NOT NULL DEFAULT 'INVOICE',
    "supplierGstin" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceNumberNorm" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "placeOfSupply" TEXT,
    "reverseCharge" BOOLEAN NOT NULL DEFAULT false,
    "itcEligible" BOOLEAN NOT NULL DEFAULT true,
    "taxableValue" DECIMAL(15,2) NOT NULL,
    "igst" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cess" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "invoiceValue" DECIMAL(15,2) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "rawData" JSONB,
    "notes" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gstr2bRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gstinRegistrationId" TEXT NOT NULL,
    "taxPeriodId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "source" "Gstr2bSource" NOT NULL,
    "importJobId" TEXT,
    "docType" "DocType" NOT NULL DEFAULT 'INVOICE',
    "supplierGstin" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceNumberNorm" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "placeOfSupply" TEXT,
    "reverseCharge" BOOLEAN NOT NULL DEFAULT false,
    "itcAvailable" BOOLEAN NOT NULL DEFAULT true,
    "itcReason" TEXT,
    "supplierFilingPeriod" TEXT,
    "supplierFilingDate" DATE,
    "taxableValue" DECIMAL(15,2) NOT NULL,
    "igst" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cess" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "invoiceValue" DECIMAL(15,2) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "rawData" JSONB,
    "supersededAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gstr2bRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gstinRegistrationId" TEXT,
    "taxPeriodId" TEXT,
    "type" "ImportType" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "fileName" TEXT,
    "fileHash" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "unchangedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "meta" JSONB,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZohoConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gstinRegistrationId" TEXT NOT NULL,
    "dc" TEXT NOT NULL DEFAULT 'in',
    "zohoOrganizationId" TEXT,
    "zohoOrganizationName" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "apiDomain" TEXT NOT NULL,
    "status" "ZohoStatus" NOT NULL DEFAULT 'PENDING_ORG_SELECTION',
    "autoSync" BOOLEAN NOT NULL DEFAULT true,
    "syncFromDate" DATE,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "skipCache" JSONB,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZohoConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gstinRegistrationId" TEXT NOT NULL,
    "financialYear" TEXT,
    "options" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationResult" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "gstinRegistrationId" TEXT NOT NULL,
    "taxPeriodId" TEXT,
    "vendorId" TEXT,
    "invoiceId" TEXT,
    "gstr2bRecordId" TEXT,
    "pairKey" TEXT NOT NULL,
    "status" "ReconStatus" NOT NULL,
    "matchMethod" "MatchMethod" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "differences" JSONB,
    "docType" "DocType" NOT NULL DEFAULT 'INVOICE',
    "supplierGstin" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE,
    "booksTaxable" DECIMAL(15,2),
    "booksTax" DECIMAL(15,2),
    "gstr2bTaxable" DECIMAL(15,2),
    "gstr2bTax" DECIMAL(15,2),
    "taxableVariance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxVariance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "booksItc" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "gstr2bItc" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "matchedItc" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "decision" "Decision" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "followUpDueDate" DATE,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "CommentKind" NOT NULL DEFAULT 'NOTE',
    "body" TEXT NOT NULL,
    "dueDate" DATE,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "Client_organizationId_idx" ON "Client"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_organizationId_name_key" ON "Client"("organizationId", "name");

-- CreateIndex
CREATE INDEX "GstinRegistration_clientId_idx" ON "GstinRegistration"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "GstinRegistration_organizationId_gstin_key" ON "GstinRegistration"("organizationId", "gstin");

-- CreateIndex
CREATE INDEX "TaxPeriod_organizationId_financialYear_idx" ON "TaxPeriod"("organizationId", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "TaxPeriod_gstinRegistrationId_year_month_key" ON "TaxPeriod"("gstinRegistrationId", "year", "month");

-- CreateIndex
CREATE INDEX "Vendor_organizationId_name_idx" ON "Vendor"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_organizationId_gstin_key" ON "Vendor"("organizationId", "gstin");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_gstinRegistrationId_supersededAt_idx" ON "Invoice"("organizationId", "gstinRegistrationId", "supersededAt");

-- CreateIndex
CREATE INDEX "Invoice_gstinRegistrationId_supplierGstin_invoiceNumberNorm_idx" ON "Invoice"("gstinRegistrationId", "supplierGstin", "invoiceNumberNorm");

-- CreateIndex
CREATE INDEX "Invoice_taxPeriodId_idx" ON "Invoice"("taxPeriodId");

-- CreateIndex
CREATE INDEX "Invoice_vendorId_idx" ON "Invoice"("vendorId");

-- CreateIndex
CREATE INDEX "Invoice_importJobId_idx" ON "Invoice"("importJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_gstinRegistrationId_source_externalId_contentHash_key" ON "Invoice"("gstinRegistrationId", "source", "externalId", "contentHash");

-- CreateIndex
CREATE INDEX "Gstr2bRecord_organizationId_gstinRegistrationId_supersededA_idx" ON "Gstr2bRecord"("organizationId", "gstinRegistrationId", "supersededAt");

-- CreateIndex
CREATE INDEX "Gstr2bRecord_gstinRegistrationId_supplierGstin_invoiceNumbe_idx" ON "Gstr2bRecord"("gstinRegistrationId", "supplierGstin", "invoiceNumberNorm");

-- CreateIndex
CREATE INDEX "Gstr2bRecord_taxPeriodId_idx" ON "Gstr2bRecord"("taxPeriodId");

-- CreateIndex
CREATE INDEX "Gstr2bRecord_vendorId_idx" ON "Gstr2bRecord"("vendorId");

-- CreateIndex
CREATE INDEX "Gstr2bRecord_importJobId_idx" ON "Gstr2bRecord"("importJobId");

-- CreateIndex
CREATE INDEX "ImportJob_organizationId_startedAt_idx" ON "ImportJob"("organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ZohoConnection_gstinRegistrationId_key" ON "ZohoConnection"("gstinRegistrationId");

-- CreateIndex
CREATE INDEX "ZohoConnection_organizationId_idx" ON "ZohoConnection"("organizationId");

-- CreateIndex
CREATE INDEX "ReconciliationRun_organizationId_gstinRegistrationId_create_idx" ON "ReconciliationRun"("organizationId", "gstinRegistrationId", "createdAt");

-- CreateIndex
CREATE INDEX "ReconciliationResult_organizationId_gstinRegistrationId_isS_idx" ON "ReconciliationResult"("organizationId", "gstinRegistrationId", "isStale", "status");

-- CreateIndex
CREATE INDEX "ReconciliationResult_taxPeriodId_idx" ON "ReconciliationResult"("taxPeriodId");

-- CreateIndex
CREATE INDEX "ReconciliationResult_vendorId_idx" ON "ReconciliationResult"("vendorId");

-- CreateIndex
CREATE INDEX "ReconciliationResult_assigneeId_idx" ON "ReconciliationResult"("assigneeId");

-- CreateIndex
CREATE INDEX "ReconciliationResult_decision_idx" ON "ReconciliationResult"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationResult_organizationId_pairKey_key" ON "ReconciliationResult"("organizationId", "pairKey");

-- CreateIndex
CREATE INDEX "Comment_resultId_createdAt_idx" ON "Comment"("resultId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstinRegistration" ADD CONSTRAINT "GstinRegistration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstinRegistration" ADD CONSTRAINT "GstinRegistration_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPeriod" ADD CONSTRAINT "TaxPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxPeriod" ADD CONSTRAINT "TaxPeriod_gstinRegistrationId_fkey" FOREIGN KEY ("gstinRegistrationId") REFERENCES "GstinRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_gstinRegistrationId_fkey" FOREIGN KEY ("gstinRegistrationId") REFERENCES "GstinRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_taxPeriodId_fkey" FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gstr2bRecord" ADD CONSTRAINT "Gstr2bRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gstr2bRecord" ADD CONSTRAINT "Gstr2bRecord_gstinRegistrationId_fkey" FOREIGN KEY ("gstinRegistrationId") REFERENCES "GstinRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gstr2bRecord" ADD CONSTRAINT "Gstr2bRecord_taxPeriodId_fkey" FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gstr2bRecord" ADD CONSTRAINT "Gstr2bRecord_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gstr2bRecord" ADD CONSTRAINT "Gstr2bRecord_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_gstinRegistrationId_fkey" FOREIGN KEY ("gstinRegistrationId") REFERENCES "GstinRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_taxPeriodId_fkey" FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZohoConnection" ADD CONSTRAINT "ZohoConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZohoConnection" ADD CONSTRAINT "ZohoConnection_gstinRegistrationId_fkey" FOREIGN KEY ("gstinRegistrationId") REFERENCES "GstinRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_gstinRegistrationId_fkey" FOREIGN KEY ("gstinRegistrationId") REFERENCES "GstinRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_gstinRegistrationId_fkey" FOREIGN KEY ("gstinRegistrationId") REFERENCES "GstinRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_taxPeriodId_fkey" FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_gstr2bRecordId_fkey" FOREIGN KEY ("gstr2bRecordId") REFERENCES "Gstr2bRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "ReconciliationResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

