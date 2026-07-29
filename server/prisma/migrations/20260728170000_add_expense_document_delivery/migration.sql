CREATE TABLE "expense_email_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "expense_note_id" UUID NOT NULL,
  "sent_by" UUID,
  "recipient_email" VARCHAR(255) NOT NULL,
  "cc" VARCHAR(1000),
  "bcc" VARCHAR(1000),
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
  CONSTRAINT "expense_email_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_email_logs_expense_note_id_idx" ON "expense_email_logs"("expense_note_id");
CREATE INDEX "expense_email_logs_status_idx" ON "expense_email_logs"("status");
CREATE INDEX "expense_email_logs_created_at_idx" ON "expense_email_logs"("created_at");

ALTER TABLE "expense_email_logs" ADD CONSTRAINT "expense_email_logs_expense_note_id_fkey"
  FOREIGN KEY ("expense_note_id") REFERENCES "expense_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "expense_email_logs" ADD CONSTRAINT "expense_email_logs_sent_by_fkey"
  FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("id","key","description","resource","action","created_at","updated_at") VALUES
  (gen_random_uuid(),'expense_notes.pdf.preview','Previsualiser les PDF de notes de frais','expense_notes','pdf.preview',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.pdf.download','Telecharger les PDF de notes de frais','expense_notes','pdf.download',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.pdf.print','Imprimer les PDF de notes de frais','expense_notes','pdf.print',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.pdf.bulk_export','Exporter plusieurs notes de frais en PDF','expense_notes','pdf.bulk_export',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.report.export','Exporter les rapports de notes de frais','expense_notes','report.export',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.email.send','Envoyer les notes de frais par email','expense_notes','email.send',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.email.resend','Renvoyer les emails de notes de frais','expense_notes','email.resend',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.email.history','Consulter l historique email des notes de frais','expense_notes','email.history',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.export.excel','Exporter les notes de frais en Excel','expense_notes','export.excel',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id","permission_id","scope","assigned_at")
SELECT r.id,p.id,'ALL',CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name='ADMIN' AND p.key IN (
  'expense_notes.pdf.preview','expense_notes.pdf.download','expense_notes.pdf.print',
  'expense_notes.pdf.bulk_export','expense_notes.report.export','expense_notes.email.send',
  'expense_notes.email.resend','expense_notes.email.history','expense_notes.export.excel'
)
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope"='ALL';

INSERT INTO "role_permissions" ("role_id","permission_id","scope","assigned_at")
SELECT r.id,p.id,'OWN',CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name='EMPLOYEE' AND p.key IN (
  'expense_notes.pdf.preview','expense_notes.pdf.download','expense_notes.pdf.print',
  'expense_notes.report.export','expense_notes.email.send','expense_notes.email.history',
  'expense_notes.export.excel'
)
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope"='OWN';
