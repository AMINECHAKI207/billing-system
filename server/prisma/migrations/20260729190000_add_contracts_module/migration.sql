CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'SIGNED', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED');
CREATE TYPE "ContractRenewalType" AS ENUM ('NONE', 'MANUAL', 'AUTOMATIC');
CREATE TYPE "ContractSignatureLinkStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');

CREATE TABLE "contract_sequences" (
  "year" INTEGER NOT NULL,
  "next_number" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contract_sequences_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "contract_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(80) NOT NULL,
  "name_fr" VARCHAR(255) NOT NULL,
  "name_en" VARCHAR(255) NOT NULL,
  "name_ar" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "content" TEXT NOT NULL,
  "structured_data" JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contracts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contract_number" VARCHAR(50) NOT NULL,
  "client_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "sent_by" UUID,
  "company_signed_by" UUID,
  "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
  "title" VARCHAR(255) NOT NULL,
  "contract_type" VARCHAR(80) NOT NULL DEFAULT 'GENERAL',
  "language" VARCHAR(10) NOT NULL DEFAULT 'fr',
  "start_date" DATE,
  "end_date" DATE,
  "renewal_type" "ContractRenewalType" NOT NULL DEFAULT 'NONE',
  "renewal_notice_days" INTEGER,
  "amount" DECIMAL(12,2),
  "currency" VARCHAR(10) NOT NULL DEFAULT 'MAD',
  "summary" TEXT,
  "terms" TEXT,
  "current_version_id" UUID,
  "signed_version_id" UUID,
  "pdf_hash" VARCHAR(128),
  "sent_at" TIMESTAMP(3),
  "viewed_at" TIMESTAMP(3),
  "signed_at" TIMESTAMP(3),
  "activated_at" TIMESTAMP(3),
  "expired_at" TIMESTAMP(3),
  "terminated_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "content" TEXT NOT NULL,
  "structured_data" JSONB,
  "is_signed" BOOLEAN NOT NULL DEFAULT false,
  "content_hash" VARCHAR(128) NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_signature_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "recipient_email" VARCHAR(255) NOT NULL,
  "recipient_name" VARCHAR(255),
  "status" "ContractSignatureLinkStatus" NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "viewed_at" TIMESTAMP(3),
  "used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "ip_address" VARCHAR(100),
  "user_agent" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_signature_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL,
  "actor_id" UUID,
  "action" VARCHAR(80) NOT NULL,
  "previous_values" JSONB,
  "new_values" JSONB,
  "ip_address" VARCHAR(100),
  "user_agent" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_email_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL,
  "sent_by" UUID,
  "recipient_email" VARCHAR(255) NOT NULL,
  "cc" TEXT,
  "subject" VARCHAR(255) NOT NULL,
  "message" TEXT NOT NULL,
  "pdf_language" VARCHAR(10) NOT NULL DEFAULT 'fr',
  "attachment_name" VARCHAR(255) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "message_id" VARCHAR(255),
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_email_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_templates_code_key" ON "contract_templates"("code");
CREATE INDEX "contract_templates_is_active_idx" ON "contract_templates"("is_active");
CREATE INDEX "contract_templates_sort_order_idx" ON "contract_templates"("sort_order");
CREATE UNIQUE INDEX "contracts_contract_number_key" ON "contracts"("contract_number");
CREATE UNIQUE INDEX "contracts_current_version_id_key" ON "contracts"("current_version_id");
CREATE UNIQUE INDEX "contracts_signed_version_id_key" ON "contracts"("signed_version_id");
CREATE INDEX "contracts_client_id_idx" ON "contracts"("client_id");
CREATE INDEX "contracts_created_by_idx" ON "contracts"("created_by");
CREATE INDEX "contracts_status_idx" ON "contracts"("status");
CREATE INDEX "contracts_start_date_idx" ON "contracts"("start_date");
CREATE INDEX "contracts_end_date_idx" ON "contracts"("end_date");
CREATE UNIQUE INDEX "contract_versions_contract_id_version_number_key" ON "contract_versions"("contract_id", "version_number");
CREATE INDEX "contract_versions_contract_id_idx" ON "contract_versions"("contract_id");
CREATE INDEX "contract_versions_created_by_idx" ON "contract_versions"("created_by");
CREATE UNIQUE INDEX "contract_signature_links_token_hash_key" ON "contract_signature_links"("token_hash");
CREATE INDEX "contract_signature_links_contract_id_idx" ON "contract_signature_links"("contract_id");
CREATE INDEX "contract_signature_links_status_idx" ON "contract_signature_links"("status");
CREATE INDEX "contract_signature_links_expires_at_idx" ON "contract_signature_links"("expires_at");
CREATE INDEX "contract_audit_logs_contract_id_idx" ON "contract_audit_logs"("contract_id");
CREATE INDEX "contract_audit_logs_actor_id_idx" ON "contract_audit_logs"("actor_id");
CREATE INDEX "contract_audit_logs_action_idx" ON "contract_audit_logs"("action");
CREATE INDEX "contract_audit_logs_created_at_idx" ON "contract_audit_logs"("created_at");
CREATE INDEX "contract_email_logs_contract_id_idx" ON "contract_email_logs"("contract_id");
CREATE INDEX "contract_email_logs_status_idx" ON "contract_email_logs"("status");
CREATE INDEX "contract_email_logs_created_at_idx" ON "contract_email_logs"("created_at");

ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_signed_by_fkey" FOREIGN KEY ("company_signed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "contract_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_signed_version_id_fkey" FOREIGN KEY ("signed_version_id") REFERENCES "contract_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_signature_links" ADD CONSTRAINT "contract_signature_links_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_audit_logs" ADD CONSTRAINT "contract_audit_logs_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_audit_logs" ADD CONSTRAINT "contract_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contract_email_logs" ADD CONSTRAINT "contract_email_logs_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_email_logs" ADD CONSTRAINT "contract_email_logs_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "contract_templates" ("code", "name_fr", "name_en", "name_ar", "description", "content", "is_active", "is_system", "sort_order", "updated_at")
VALUES
  ('SERVICE_AGREEMENT', 'Contrat de prestation de services', 'Service agreement', 'عقد تقديم خدمات', 'Modele standard pour prestations de services.', 'Objet du contrat\nLe prestataire fournit les services decrits dans la proposition acceptee.\n\nObligations\nChaque partie s engage a executer ses obligations avec diligence et bonne foi.\n\nPaiement\nLes montants, taxes et echeances sont definis dans les conditions particulieres.\n\nConfidentialite\nLes informations confidentielles doivent rester protegees pendant et apres le contrat.', true, true, 10, CURRENT_TIMESTAMP),
  ('MAINTENANCE', 'Contrat de maintenance', 'Maintenance contract', 'عقد صيانة', 'Modele pour maintenance et support.', 'Objet du contrat\nLe prestataire assure la maintenance corrective et preventive des services convenus.\n\nNiveaux de service\nLes delais d intervention sont definis dans les conditions particulieres.\n\nPaiement\nLa facturation suit la periodicite convenue entre les parties.', true, true, 20, CURRENT_TIMESTAMP),
  ('SUBSCRIPTION', 'Contrat d abonnement', 'Subscription contract', 'عقد اشتراك', 'Modele pour abonnement recurrent.', 'Objet du contrat\nLe client souscrit a un service recurrent selon les conditions particulieres.\n\nRenouvellement\nLe renouvellement est gere selon le type choisi dans le contrat.\n\nResiliation\nChaque partie peut resilier selon les preavis convenus.', true, true, 30, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name_fr" = EXCLUDED."name_fr",
  "name_en" = EXCLUDED."name_en",
  "name_ar" = EXCLUDED."name_ar",
  "description" = EXCLUDED."description",
  "content" = EXCLUDED."content",
  "is_active" = true,
  "is_system" = true,
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "permissions" ("id", "key", "description", "resource", "action", "updated_at")
VALUES
  (gen_random_uuid(), 'contracts.view', 'View contracts', 'contracts', 'view', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.create', 'Create contracts', 'contracts', 'create', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.update', 'Update draft contracts', 'contracts', 'update', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.delete', 'Delete draft contracts', 'contracts', 'delete', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.send', 'Send contracts', 'contracts', 'send', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.sign.company', 'Sign contracts for the company', 'contracts', 'sign.company', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.terminate', 'Terminate active contracts', 'contracts', 'terminate', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.cancel', 'Cancel draft or sent contracts', 'contracts', 'cancel', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.pdf.preview', 'Preview contract PDF', 'contracts', 'pdf.preview', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.pdf.download', 'Download contract PDF', 'contracts', 'pdf.download', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.email.send', 'Send contracts by email', 'contracts', 'email.send', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.email.history', 'View contract email history', 'contracts', 'email.history', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contract_templates.manage', 'Manage contract templates', 'contract_templates', 'manage', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contract_templates.view', 'View contract templates', 'contract_templates', 'view', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "description" = EXCLUDED."description",
  "resource" = EXCLUDED."resource",
  "action" = EXCLUDED."action",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope")
SELECT r."id", p."id", 'ALL'::"PermissionScope"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" = 'ADMIN'
  AND p."resource" IN ('contracts', 'contract_templates')
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope" = EXCLUDED."scope";

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope")
SELECT r."id", p."id", 'OWN'::"PermissionScope"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" = 'EMPLOYEE'
  AND p."key" IN ('contracts.view', 'contracts.create', 'contracts.update', 'contracts.pdf.preview', 'contracts.pdf.download', 'contract_templates.view')
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope" = EXCLUDED."scope";
