CREATE TYPE "ExpenseNoteStatus" AS ENUM ('DRAFT', 'PROCESSING', 'NEEDS_REVIEW', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'PAID');

ALTER TABLE "expense_notes"
  ADD COLUMN "status" "ExpenseNoteStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "document_number" VARCHAR(255),
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "approved_by" UUID,
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "rejected_by" UUID,
  ADD COLUMN "rejected_at" TIMESTAMP(3),
  ADD COLUMN "rejection_reason" TEXT,
  ADD COLUMN "changes_requested_by" UUID,
  ADD COLUMN "changes_requested_at" TIMESTAMP(3),
  ADD COLUMN "changes_requested_reason" TEXT,
  ADD COLUMN "paid_by" UUID,
  ADD COLUMN "paid_at" TIMESTAMP(3);

UPDATE "expense_notes" SET "document_number" = "receipt_number" WHERE "document_number" IS NULL;

ALTER TABLE "expense_ai_analyses"
  ADD COLUMN "provider" VARCHAR(80) NOT NULL DEFAULT 'openai',
  ADD COLUMN "processing_duration_ms" INTEGER,
  ADD COLUMN "completed_at" TIMESTAMP(3);

CREATE TABLE "expense_audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "expense_note_id" UUID NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "actor_id" UUID NOT NULL,
  "previous_values" JSONB,
  "new_values" JSONB,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expense_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_notes_status_idx" ON "expense_notes"("status");
CREATE INDEX "expense_notes_submitted_at_idx" ON "expense_notes"("submitted_at");
CREATE INDEX "expense_notes_approved_by_idx" ON "expense_notes"("approved_by");
CREATE INDEX "expense_notes_rejected_by_idx" ON "expense_notes"("rejected_by");
CREATE INDEX "expense_notes_changes_requested_by_idx" ON "expense_notes"("changes_requested_by");
CREATE INDEX "expense_notes_paid_by_idx" ON "expense_notes"("paid_by");
CREATE INDEX "expense_audit_logs_expense_note_id_idx" ON "expense_audit_logs"("expense_note_id");
CREATE INDEX "expense_audit_logs_actor_id_idx" ON "expense_audit_logs"("actor_id");
CREATE INDEX "expense_audit_logs_action_idx" ON "expense_audit_logs"("action");
CREATE INDEX "expense_audit_logs_created_at_idx" ON "expense_audit_logs"("created_at");

ALTER TABLE "expense_notes" ADD CONSTRAINT "expense_notes_approved_by_fkey"
  FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_notes" ADD CONSTRAINT "expense_notes_rejected_by_fkey"
  FOREIGN KEY ("rejected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_notes" ADD CONSTRAINT "expense_notes_changes_requested_by_fkey"
  FOREIGN KEY ("changes_requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_notes" ADD CONSTRAINT "expense_notes_paid_by_fkey"
  FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_audit_logs" ADD CONSTRAINT "expense_audit_logs_expense_note_id_fkey"
  FOREIGN KEY ("expense_note_id") REFERENCES "expense_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_audit_logs" ADD CONSTRAINT "expense_audit_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id","key","description","resource","action","created_at","updated_at") VALUES
  (gen_random_uuid(),'expense_notes.submit','Soumettre des notes de frais','expense_notes','submit',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.request_changes','Demander des corrections sur les notes de frais','expense_notes','request_changes',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.approve','Approuver des notes de frais','expense_notes','approve',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.reject','Rejeter des notes de frais','expense_notes','reject',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.mark_paid','Marquer les notes de frais comme payees','expense_notes','mark_paid',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_attachments.view','Consulter les justificatifs de notes de frais','expense_attachments','view',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_categories.view','Consulter les categories de frais','expense_categories','view',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_types.view','Consulter les types de frais','expense_types','view',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_audit.view','Consulter l audit des notes de frais','expense_audit','view',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id","permission_id","scope","assigned_at")
SELECT r.id,p.id,'ALL',CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name='ADMIN' AND p.key IN (
  'expense_notes.submit','expense_notes.request_changes','expense_notes.approve','expense_notes.reject',
  'expense_notes.mark_paid','expense_attachments.view','expense_categories.view','expense_types.view','expense_audit.view'
)
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope"='ALL';

INSERT INTO "role_permissions" ("role_id","permission_id","scope","assigned_at")
SELECT r.id,p.id,'OWN',CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name='EMPLOYEE' AND p.key IN (
  'expense_notes.submit','expense_attachments.view','expense_categories.view','expense_types.view'
)
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope"='OWN';
