-- CreateEnum
CREATE TYPE "ContractPricingType" AS ENUM ('FIXED', 'HOURLY', 'DAILY', 'MONTHLY', 'MONTHLY_SUBSCRIPTION', 'ANNUAL_SUBSCRIPTION', 'MILESTONE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ContractBillingFrequency" AS ENUM ('ONE_TIME', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ContractProrationPolicy" AS ENUM ('NONE', 'ACTUAL_DAYS', 'FIXED_30_DAYS');

-- CreateEnum
CREATE TYPE "ContractTimeEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'INVOICED');

-- CreateEnum
CREATE TYPE "ContractMilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'APPROVED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractBillingScheduleStatus" AS ENUM ('PENDING', 'APPROVED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractBillingJobStatus" AS ENUM ('SUCCESS', 'FAILED');





-- AlterTable
ALTER TABLE "contract_versions" ADD COLUMN     "pricing_snapshot" JSONB;

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "auto_invoice_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "billing_day" INTEGER,
ADD COLUMN     "billing_description" TEXT,
ADD COLUMN     "billing_end_date" DATE,
ADD COLUMN     "billing_frequency" "ContractBillingFrequency" NOT NULL DEFAULT 'ONE_TIME',
ADD COLUMN     "billing_start_date" DATE,
ADD COLUMN     "estimated_quantity" DECIMAL(12,2),
ADD COLUMN     "fixed_amount" DECIMAL(12,2),
ADD COLUMN     "included_units" DECIMAL(12,2),
ADD COLUMN     "last_invoice_date" DATE,
ADD COLUMN     "minimum_billable_units" DECIMAL(12,2),
ADD COLUMN     "next_invoice_date" DATE,
ADD COLUMN     "overtime_rate" DECIMAL(12,2),
ADD COLUMN     "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "pricing_type" "ContractPricingType" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "proration_policy" "ContractProrationPolicy" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "unit_rate" DECIMAL(12,2);

-- Backfill legacy contract amounts as fixed pricing.
UPDATE "contracts" SET "fixed_amount" = "amount" WHERE "fixed_amount" IS NULL AND "amount" IS NOT NULL;









-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "billing_period_end" DATE,
ADD COLUMN     "billing_period_start" DATE,
ADD COLUMN     "contract_billing_schedule_item_id" UUID,
ADD COLUMN     "contract_id" UUID,
ADD COLUMN     "contract_milestone_id" UUID,
ADD COLUMN     "contract_version_id" UUID;

-- CreateTable
CREATE TABLE "contract_time_entries" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "invoice_id" UUID,
    "work_date" DATE NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "status" "ContractTimeEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_at" TIMESTAMP(3),
    "invoiced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_milestones" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "approved_by" UUID,
    "invoice_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "due_date" DATE,
    "amount" DECIMAL(12,2),
    "percentage" DECIMAL(5,2),
    "status" "ContractMilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "invoiced_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_billing_schedule_items" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "invoice_id" UUID,
    "label" VARCHAR(255) NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "ContractBillingScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "invoiced_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_billing_schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_billing_jobs" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "triggered_by" UUID,
    "invoice_id" UUID,
    "status" "ContractBillingJobStatus" NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_billing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_time_entries_contract_id_idx" ON "contract_time_entries"("contract_id");

-- CreateIndex
CREATE INDEX "contract_time_entries_user_id_idx" ON "contract_time_entries"("user_id");

-- CreateIndex
CREATE INDEX "contract_time_entries_status_idx" ON "contract_time_entries"("status");

-- CreateIndex
CREATE INDEX "contract_time_entries_invoice_id_idx" ON "contract_time_entries"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_milestones_invoice_id_key" ON "contract_milestones"("invoice_id");

-- CreateIndex
CREATE INDEX "contract_milestones_contract_id_idx" ON "contract_milestones"("contract_id");

-- CreateIndex
CREATE INDEX "contract_milestones_status_idx" ON "contract_milestones"("status");

-- CreateIndex
CREATE INDEX "contract_milestones_sort_order_idx" ON "contract_milestones"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "contract_billing_schedule_items_invoice_id_key" ON "contract_billing_schedule_items"("invoice_id");

-- CreateIndex
CREATE INDEX "contract_billing_schedule_items_contract_id_idx" ON "contract_billing_schedule_items"("contract_id");

-- CreateIndex
CREATE INDEX "contract_billing_schedule_items_status_idx" ON "contract_billing_schedule_items"("status");

-- CreateIndex
CREATE INDEX "contract_billing_schedule_items_due_date_idx" ON "contract_billing_schedule_items"("due_date");

-- CreateIndex
CREATE INDEX "contract_billing_jobs_contract_id_idx" ON "contract_billing_jobs"("contract_id");

-- CreateIndex
CREATE INDEX "contract_billing_jobs_status_idx" ON "contract_billing_jobs"("status");

-- CreateIndex
CREATE INDEX "contract_billing_jobs_created_at_idx" ON "contract_billing_jobs"("created_at");

-- CreateIndex
CREATE INDEX "contracts_pricing_type_idx" ON "contracts"("pricing_type");

-- CreateIndex
CREATE INDEX "contracts_auto_invoice_enabled_next_invoice_date_idx" ON "contracts"("auto_invoice_enabled", "next_invoice_date");

-- CreateIndex
CREATE INDEX "invoices_contract_id_idx" ON "invoices"("contract_id");

-- CreateIndex
CREATE INDEX "invoices_contract_version_id_idx" ON "invoices"("contract_version_id");

-- CreateIndex
CREATE INDEX "invoices_billing_period_start_billing_period_end_idx" ON "invoices"("billing_period_start", "billing_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_contract_id_billing_period_start_billing_period_en_key" ON "invoices"("contract_id", "billing_period_start", "billing_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_contract_billing_schedule_item_id_key" ON "invoices"("contract_billing_schedule_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_contract_milestone_id_key" ON "invoices"("contract_milestone_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_version_id_fkey" FOREIGN KEY ("contract_version_id") REFERENCES "contract_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_billing_schedule_item_id_fkey" FOREIGN KEY ("contract_billing_schedule_item_id") REFERENCES "contract_billing_schedule_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_milestone_id_fkey" FOREIGN KEY ("contract_milestone_id") REFERENCES "contract_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_time_entries" ADD CONSTRAINT "contract_time_entries_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_time_entries" ADD CONSTRAINT "contract_time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_time_entries" ADD CONSTRAINT "contract_time_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_time_entries" ADD CONSTRAINT "contract_time_entries_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_time_entries" ADD CONSTRAINT "contract_time_entries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_billing_schedule_items" ADD CONSTRAINT "contract_billing_schedule_items_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_billing_schedule_items" ADD CONSTRAINT "contract_billing_schedule_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_billing_jobs" ADD CONSTRAINT "contract_billing_jobs_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_billing_jobs" ADD CONSTRAINT "contract_billing_jobs_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_billing_jobs" ADD CONSTRAINT "contract_billing_jobs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
