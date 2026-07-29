CREATE TYPE "ExpenseSource" AS ENUM ('MANUAL', 'AI');
CREATE TYPE "ExpenseAIStatus" AS ENUM ('VALIDATED', 'REQUIRES_MANUAL_REVIEW', 'FAILED');

CREATE TABLE "expense_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(120) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expense_types" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "category_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expense_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expense_notes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "category_id" UUID NOT NULL,
  "expense_type_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "expense_date" DATE NOT NULL,
  "amount_ttc" DECIMAL(12,2) NOT NULL,
  "amount_ht" DECIMAL(12,2),
  "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "comment" TEXT,
  "merchant_name" VARCHAR(255),
  "receipt_number" VARCHAR(255),
  "currency" VARCHAR(10) NOT NULL DEFAULT 'MAD',
  "ai_confidence" DECIMAL(5,4),
  "ai_warnings" JSONB,
  "source" "ExpenseSource" NOT NULL DEFAULT 'MANUAL',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expense_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expense_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "expense_note_id" UUID,
  "uploaded_by" UUID NOT NULL,
  "original_name" VARCHAR(255) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "file_url" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expense_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expense_ai_analyses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "attachment_id" UUID NOT NULL,
  "expense_note_id" UUID,
  "requested_by" UUID NOT NULL,
  "model" VARCHAR(120) NOT NULL,
  "status" "ExpenseAIStatus" NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "raw_response" JSONB,
  "extracted_data" JSONB,
  "validation_errors" JSONB,
  "confidence" JSONB,
  "warnings" JSONB,
  "requires_manual_review" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expense_ai_analyses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");
CREATE INDEX "expense_categories_active_idx" ON "expense_categories"("active");
CREATE UNIQUE INDEX "expense_types_category_id_name_key" ON "expense_types"("category_id", "name");
CREATE INDEX "expense_types_category_id_idx" ON "expense_types"("category_id");
CREATE INDEX "expense_types_active_idx" ON "expense_types"("active");
CREATE INDEX "expense_notes_category_id_idx" ON "expense_notes"("category_id");
CREATE INDEX "expense_notes_expense_type_id_idx" ON "expense_notes"("expense_type_id");
CREATE INDEX "expense_notes_created_by_idx" ON "expense_notes"("created_by");
CREATE INDEX "expense_notes_expense_date_idx" ON "expense_notes"("expense_date");
CREATE INDEX "expense_notes_source_idx" ON "expense_notes"("source");
CREATE INDEX "expense_attachments_expense_note_id_idx" ON "expense_attachments"("expense_note_id");
CREATE INDEX "expense_attachments_uploaded_by_idx" ON "expense_attachments"("uploaded_by");
CREATE INDEX "expense_ai_analyses_attachment_id_idx" ON "expense_ai_analyses"("attachment_id");
CREATE INDEX "expense_ai_analyses_expense_note_id_idx" ON "expense_ai_analyses"("expense_note_id");
CREATE INDEX "expense_ai_analyses_requested_by_idx" ON "expense_ai_analyses"("requested_by");
CREATE INDEX "expense_ai_analyses_status_idx" ON "expense_ai_analyses"("status");

ALTER TABLE "expense_types" ADD CONSTRAINT "expense_types_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_notes" ADD CONSTRAINT "expense_notes_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_notes" ADD CONSTRAINT "expense_notes_expense_type_id_fkey"
  FOREIGN KEY ("expense_type_id") REFERENCES "expense_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_notes" ADD CONSTRAINT "expense_notes_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_expense_note_id_fkey"
  FOREIGN KEY ("expense_note_id") REFERENCES "expense_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_ai_analyses" ADD CONSTRAINT "expense_ai_analyses_attachment_id_fkey"
  FOREIGN KEY ("attachment_id") REFERENCES "expense_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_ai_analyses" ADD CONSTRAINT "expense_ai_analyses_expense_note_id_fkey"
  FOREIGN KEY ("expense_note_id") REFERENCES "expense_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_ai_analyses" ADD CONSTRAINT "expense_ai_analyses_requested_by_fkey"
  FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id","key","description","resource","action","created_at","updated_at") VALUES
  (gen_random_uuid(),'expense_notes.view','Consulter les notes de frais','expense_notes','view',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.create','Creer des notes de frais','expense_notes','create',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.update','Modifier des notes de frais','expense_notes','update',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.delete','Supprimer des notes de frais','expense_notes','delete',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_notes.analyze','Analyser les recus par IA','expense_notes','analyze',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_categories.manage','Gerer les categories de frais','expense_categories','manage',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'expense_types.manage','Gerer les types de frais','expense_types','manage',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id","permission_id","scope","assigned_at")
SELECT r.id,p.id,'ALL',CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name='ADMIN' AND (p.key LIKE 'expense_notes.%' OR p.key IN ('expense_categories.manage','expense_types.manage'))
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope"='ALL';

INSERT INTO "role_permissions" ("role_id","permission_id","scope","assigned_at")
SELECT r.id,p.id,'OWN',CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name='EMPLOYEE' AND p.key IN ('expense_notes.view','expense_notes.create','expense_notes.update','expense_notes.delete','expense_notes.analyze')
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope"='OWN';

WITH categories(name) AS (
  VALUES ('Transport'), ('Meals'), ('Accommodation'), ('Office'), ('Software'), ('Other')
)
INSERT INTO "expense_categories" ("id","name","active","created_at","updated_at")
SELECT gen_random_uuid(), name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM categories
ON CONFLICT ("name") DO NOTHING;

WITH type_seed(category_name, type_name) AS (
  VALUES
    ('Transport','Taxi'),
    ('Transport','Fuel'),
    ('Transport','Train'),
    ('Meals','Restaurant'),
    ('Meals','Coffee'),
    ('Accommodation','Hotel'),
    ('Office','Supplies'),
    ('Software','Subscription'),
    ('Other','General')
)
INSERT INTO "expense_types" ("id","category_id","name","active","created_at","updated_at")
SELECT gen_random_uuid(), c.id, s.type_name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM type_seed s
JOIN "expense_categories" c ON c.name = s.category_name
ON CONFLICT ("category_id", "name") DO NOTHING;
