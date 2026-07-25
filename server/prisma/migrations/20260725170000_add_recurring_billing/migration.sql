CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');
CREATE TYPE "RecurringPlanStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED');
CREATE TYPE "RecurringExecutionStatus" AS ENUM ('PROCESSING', 'SUCCESS', 'FAILED', 'SKIPPED');

CREATE TABLE "recurring_plans" (
  "id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "frequency" "RecurringFrequency" NOT NULL,
  "interval_count" INTEGER NOT NULL DEFAULT 1,
  "status" "RecurringPlanStatus" NOT NULL DEFAULT 'ACTIVE',
  "start_date" DATE NOT NULL,
  "end_date" DATE,
  "next_run_date" DATE NOT NULL,
  "last_run_at" TIMESTAMP(3),
  "due_days" INTEGER NOT NULL DEFAULT 30,
  "auto_send" BOOLEAN NOT NULL DEFAULT false,
  "currency" VARCHAR(10) NOT NULL DEFAULT 'MAD',
  "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "terms" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recurring_plans_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "recurring_plan_items" (
  "id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "unit" VARCHAR(50),
  "quantity" DECIMAL(12,2) NOT NULL,
  "unit_price" DECIMAL(12,2) NOT NULL,
  "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "recurring_plan_items_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "recurring_executions" (
  "id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "invoice_id" UUID,
  "scheduled_for" DATE NOT NULL,
  "status" "RecurringExecutionStatus" NOT NULL,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recurring_executions_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "invoices" ADD COLUMN "recurring_plan_id" UUID;
CREATE INDEX "recurring_plans_customer_id_idx" ON "recurring_plans"("customer_id");
CREATE INDEX "recurring_plans_created_by_idx" ON "recurring_plans"("created_by");
CREATE INDEX "recurring_plans_status_next_run_date_idx" ON "recurring_plans"("status", "next_run_date");
CREATE INDEX "recurring_plan_items_plan_id_idx" ON "recurring_plan_items"("plan_id");
CREATE UNIQUE INDEX "recurring_executions_plan_id_scheduled_for_key" ON "recurring_executions"("plan_id", "scheduled_for");
CREATE INDEX "recurring_executions_status_idx" ON "recurring_executions"("status");
CREATE INDEX "recurring_executions_invoice_id_idx" ON "recurring_executions"("invoice_id");
CREATE INDEX "invoices_recurring_plan_id_idx" ON "invoices"("recurring_plan_id");
ALTER TABLE "recurring_plans" ADD CONSTRAINT "recurring_plans_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_plans" ADD CONSTRAINT "recurring_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_plan_items" ADD CONSTRAINT "recurring_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "recurring_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_executions" ADD CONSTRAINT "recurring_executions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "recurring_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_executions" ADD CONSTRAINT "recurring_executions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurring_plan_id_fkey" FOREIGN KEY ("recurring_plan_id") REFERENCES "recurring_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
