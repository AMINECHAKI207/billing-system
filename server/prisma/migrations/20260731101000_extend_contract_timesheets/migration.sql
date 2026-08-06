-- Extend contract time entries into production-grade contract-based timesheets.
ALTER TYPE "ContractTimeEntryStatus" ADD VALUE IF NOT EXISTS 'LOCKED';

ALTER TABLE "contract_time_entries"
  ADD COLUMN IF NOT EXISTS "submitted_by" UUID,
  ADD COLUMN IF NOT EXISTS "rejected_by" UUID,
  ADD COLUMN IF NOT EXISTS "start_time" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "end_time" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "break_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "duration_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "billable_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "activity_type" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "internal_note" TEXT,
  ADD COLUMN IF NOT EXISTS "applied_rate" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3),
  ADD COLUMN IF NOT EXISTS "calculated_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "pricing_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3);

UPDATE "contract_time_entries"
SET
  "duration_minutes" = CASE
    WHEN "duration_minutes" = 0 THEN ROUND(("quantity"::numeric * 60))::integer
    ELSE "duration_minutes"
  END,
  "billable_minutes" = CASE
    WHEN "billable_minutes" = 0 AND "billable" = true THEN ROUND(("quantity"::numeric * 60))::integer
    ELSE "billable_minutes"
  END
WHERE "duration_minutes" = 0 OR "billable_minutes" = 0;

ALTER TABLE "contract_time_entries"
  ADD CONSTRAINT "contract_time_entries_submitted_by_fkey"
    FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "contract_time_entries_rejected_by_fkey"
    FOREIGN KEY ("rejected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "contract_time_entries_user_id_work_date_idx" ON "contract_time_entries"("user_id", "work_date");
CREATE INDEX IF NOT EXISTS "contract_time_entries_contract_id_status_invoice_id_idx" ON "contract_time_entries"("contract_id", "status", "invoice_id");
