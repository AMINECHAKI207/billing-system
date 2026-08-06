CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'VALIDATED', 'CANCELLED', 'REFUNDED');
CREATE TYPE "CreditNoteType" AS ENUM ('PARTIAL', 'FULL');
CREATE TYPE "CreditNoteRefundStatus" AS ENUM ('NOT_REFUNDED', 'PARTIALLY_REFUNDED', 'REFUNDED');

CREATE TABLE "credit_note_sequences" (
  "year" INTEGER NOT NULL,
  "next_number" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "credit_note_sequences_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "credit_notes" (
  "id" UUID NOT NULL,
  "credit_note_number" VARCHAR(50) NOT NULL,
  "invoice_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "validated_by" UUID,
  "cancelled_by" UUID,
  "refunded_by" UUID,
  "type" "CreditNoteType" NOT NULL DEFAULT 'PARTIAL',
  "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
  "issue_date" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "internal_comment" TEXT,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(10) NOT NULL DEFAULT 'MAD',
  "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "refund_status" "CreditNoteRefundStatus" NOT NULL DEFAULT 'NOT_REFUNDED',
  "validated_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "refunded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_note_lines" (
  "id" UUID NOT NULL,
  "credit_note_id" UUID NOT NULL,
  "invoice_item_id" UUID,
  "description" TEXT NOT NULL,
  "unit" VARCHAR(50),
  "quantity" DECIMAL(12,2) NOT NULL,
  "unit_price" DECIMAL(12,2) NOT NULL,
  "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "line_total" DECIMAL(12,2) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_note_audit_logs" (
  "id" UUID NOT NULL,
  "credit_note_id" UUID NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "actor_id" UUID NOT NULL,
  "previous_values" JSONB,
  "new_values" JSONB,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_note_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_note_email_logs" (
  "id" UUID NOT NULL,
  "credit_note_id" UUID NOT NULL,
  "sent_by" UUID,
  "recipient_email" VARCHAR(255) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "message" TEXT NOT NULL,
  "pdf_language" VARCHAR(10) NOT NULL DEFAULT 'fr',
  "attachment_name" VARCHAR(255) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "delivery_mode" VARCHAR(30),
  "message_id" VARCHAR(255),
  "file_path" VARCHAR(1000),
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_note_email_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_notes_credit_note_number_key" ON "credit_notes"("credit_note_number");
CREATE INDEX "credit_notes_credit_note_number_idx" ON "credit_notes"("credit_note_number");
CREATE INDEX "credit_notes_invoice_id_idx" ON "credit_notes"("invoice_id");
CREATE INDEX "credit_notes_customer_id_idx" ON "credit_notes"("customer_id");
CREATE INDEX "credit_notes_created_by_idx" ON "credit_notes"("created_by");
CREATE INDEX "credit_notes_status_idx" ON "credit_notes"("status");
CREATE INDEX "credit_notes_issue_date_idx" ON "credit_notes"("issue_date");
CREATE INDEX "credit_note_lines_credit_note_id_idx" ON "credit_note_lines"("credit_note_id");
CREATE INDEX "credit_note_lines_invoice_item_id_idx" ON "credit_note_lines"("invoice_item_id");
CREATE INDEX "credit_note_audit_logs_credit_note_id_idx" ON "credit_note_audit_logs"("credit_note_id");
CREATE INDEX "credit_note_audit_logs_actor_id_idx" ON "credit_note_audit_logs"("actor_id");
CREATE INDEX "credit_note_audit_logs_action_idx" ON "credit_note_audit_logs"("action");
CREATE INDEX "credit_note_audit_logs_created_at_idx" ON "credit_note_audit_logs"("created_at");
CREATE INDEX "credit_note_email_logs_credit_note_id_idx" ON "credit_note_email_logs"("credit_note_id");
CREATE INDEX "credit_note_email_logs_status_idx" ON "credit_note_email_logs"("status");
CREATE INDEX "credit_note_email_logs_created_at_idx" ON "credit_note_email_logs"("created_at");

ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_validated_by_fkey"
  FOREIGN KEY ("validated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_cancelled_by_fkey"
  FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_refunded_by_fkey"
  FOREIGN KEY ("refunded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_fkey"
  FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_item_id_fkey"
  FOREIGN KEY ("invoice_item_id") REFERENCES "invoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "credit_note_audit_logs" ADD CONSTRAINT "credit_note_audit_logs_credit_note_id_fkey"
  FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_note_audit_logs" ADD CONSTRAINT "credit_note_audit_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_note_email_logs" ADD CONSTRAINT "credit_note_email_logs_credit_note_id_fkey"
  FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_note_email_logs" ADD CONSTRAINT "credit_note_email_logs_sent_by_fkey"
  FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("id","key","description","resource","action","created_at","updated_at") VALUES
  (gen_random_uuid(),'credit_notes.view','Consulter les avoirs','credit_notes','view',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'credit_notes.create','Creer des avoirs','credit_notes','create',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'credit_notes.update','Modifier des avoirs brouillon','credit_notes','update',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'credit_notes.validate','Valider des avoirs','credit_notes','validate',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'credit_notes.cancel','Annuler des avoirs','credit_notes','cancel',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'credit_notes.refund','Enregistrer des remboursements d avoir','credit_notes','refund',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'credit_notes.pdf.download','Telecharger les PDF d avoir','credit_notes','pdf.download',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'credit_notes.email.send','Envoyer les avoirs par email','credit_notes','email.send',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id","permission_id","scope","assigned_at")
SELECT r.id,p.id,'ALL',CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name='ADMIN' AND p.key LIKE 'credit_notes.%'
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope"='ALL';

INSERT INTO "role_permissions" ("role_id","permission_id","scope","assigned_at")
SELECT r.id,p.id,'OWN',CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name='EMPLOYEE' AND p.key IN (
  'credit_notes.view','credit_notes.create','credit_notes.update','credit_notes.pdf.download','credit_notes.email.send'
)
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope"='OWN';
