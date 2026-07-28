CREATE TYPE "DevisStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONVERTED');

CREATE TABLE "devis_sequences" (
  "year" INTEGER NOT NULL,
  "next_number" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "devis_sequences_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "devis" (
  "id" UUID NOT NULL,
  "devis_number" VARCHAR(50) NOT NULL,
  "company_id" INTEGER NOT NULL DEFAULT 1,
  "customer_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "status" "DevisStatus" NOT NULL DEFAULT 'DRAFT',
  "issue_date" DATE NOT NULL,
  "valid_until" DATE NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "customer_country" VARCHAR(100) NOT NULL DEFAULT 'Morocco',
  "customer_country_code" VARCHAR(2) NOT NULL DEFAULT 'MA',
  "vat_overridden" BOOLEAN NOT NULL DEFAULT false,
  "vat_override_reason" VARCHAR(500),
  "vat_overridden_at" TIMESTAMP(3),
  "vat_overridden_by" UUID,
  "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "notes" TEXT,
  "terms" TEXT,
  "currency" VARCHAR(10) NOT NULL DEFAULT 'MAD',
  "sent_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "converted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "devis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "devis_items" (
  "id" UUID NOT NULL,
  "devis_id" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "unit" VARCHAR(50),
  "quantity" DECIMAL(12,2) NOT NULL,
  "unit_price" DECIMAL(12,2) NOT NULL,
  "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "line_total" DECIMAL(12,2) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "devis_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "invoices" ADD COLUMN "source_devis_id" UUID;

CREATE UNIQUE INDEX "devis_devis_number_key" ON "devis"("devis_number");
CREATE INDEX "devis_devis_number_idx" ON "devis"("devis_number");
CREATE INDEX "devis_status_idx" ON "devis"("status");
CREATE INDEX "devis_issue_date_idx" ON "devis"("issue_date");
CREATE INDEX "devis_valid_until_idx" ON "devis"("valid_until");
CREATE INDEX "devis_customer_id_idx" ON "devis"("customer_id");
CREATE INDEX "devis_created_by_idx" ON "devis"("created_by");
CREATE INDEX "devis_vat_overridden_by_idx" ON "devis"("vat_overridden_by");
CREATE INDEX "devis_items_devis_id_idx" ON "devis_items"("devis_id");
CREATE UNIQUE INDEX "invoices_source_devis_id_key" ON "invoices"("source_devis_id");
CREATE INDEX "invoices_source_devis_id_idx" ON "invoices"("source_devis_id");

ALTER TABLE "devis" ADD CONSTRAINT "devis_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "company_settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "devis" ADD CONSTRAINT "devis_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "devis" ADD CONSTRAINT "devis_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "devis" ADD CONSTRAINT "devis_vat_overridden_by_fkey"
  FOREIGN KEY ("vat_overridden_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "devis_items" ADD CONSTRAINT "devis_items_devis_id_fkey"
  FOREIGN KEY ("devis_id") REFERENCES "devis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_devis_id_fkey"
  FOREIGN KEY ("source_devis_id") REFERENCES "devis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("id","key","description","resource","action","created_at","updated_at") VALUES
  (gen_random_uuid(),'devis.view','Consulter les devis','devis','view',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'devis.create','Creer des devis','devis','create',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'devis.update','Modifier des devis','devis','update',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'devis.delete','Supprimer des devis','devis','delete',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'devis.send','Envoyer des devis','devis','send',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'devis.approve','Approuver des devis','devis','approve',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'devis.reject','Rejeter des devis','devis','reject',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'devis.convert','Convertir des devis en factures','devis','convert',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid(),'devis.download','Telecharger des devis','devis','download',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id","permission_id","scope","assigned_at")
SELECT r.id,p.id,'ALL',CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name='ADMIN' AND p.key LIKE 'devis.%'
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope"='ALL';

INSERT INTO "role_permissions" ("role_id","permission_id","scope","assigned_at")
SELECT r.id,p.id,'OWN',CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name='EMPLOYEE' AND p.key IN (
  'devis.view','devis.create','devis.update','devis.send','devis.approve','devis.reject','devis.convert','devis.download'
)
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope"='OWN';
