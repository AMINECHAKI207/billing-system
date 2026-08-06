CREATE TYPE "ContractSignatureStatus" AS ENUM (
  'NOT_STARTED',
  'COMPANY_PENDING',
  'COMPANY_SIGNED',
  'CLIENT_PENDING',
  'CLIENT_SIGNED',
  'COMPLETED',
  'REVOKED'
);

ALTER TABLE "contract_versions"
  ADD COLUMN "signature_status" "ContractSignatureStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "company_signature_url" VARCHAR(500),
  ADD COLUMN "company_stamp_url" VARCHAR(500),
  ADD COLUMN "company_signed_by" UUID,
  ADD COLUMN "company_signed_at" TIMESTAMP(3),
  ADD COLUMN "client_signer_name" VARCHAR(255),
  ADD COLUMN "client_signer_email" VARCHAR(255),
  ADD COLUMN "client_signed_at" TIMESTAMP(3),
  ADD COLUMN "signed_pdf_hash" VARCHAR(128),
  ADD COLUMN "signed_pdf_storage_key" VARCHAR(1000),
  ADD COLUMN "revoked_at" TIMESTAMP(3),
  ADD COLUMN "revoked_by" UUID,
  ADD COLUMN "revocation_reason" TEXT,
  ADD COLUMN "revocation_note" TEXT,
  ADD COLUMN "previous_pdf_hash" VARCHAR(128);

UPDATE "contract_versions" cv
SET
  "signature_status" = CASE
    WHEN c."status" = 'ACTIVE' THEN 'COMPLETED'::"ContractSignatureStatus"
    WHEN c."status" = 'SIGNED' THEN 'COMPANY_SIGNED'::"ContractSignatureStatus"
    WHEN cv."is_signed" = true THEN 'COMPANY_SIGNED'::"ContractSignatureStatus"
    ELSE 'NOT_STARTED'::"ContractSignatureStatus"
  END,
  "company_signed_by" = c."company_signed_by",
  "company_signed_at" = c."signed_at",
  "signed_pdf_hash" = c."pdf_hash",
  "previous_pdf_hash" = c."pdf_hash"
FROM "contracts" c
WHERE cv."id" = c."signed_version_id";

ALTER TABLE "contract_versions"
  ADD CONSTRAINT "contract_versions_company_signed_by_fkey"
    FOREIGN KEY ("company_signed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "contract_versions_revoked_by_fkey"
    FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "contract_versions_signature_status_idx" ON "contract_versions"("signature_status");
CREATE INDEX "contract_versions_company_signed_by_idx" ON "contract_versions"("company_signed_by");
CREATE INDEX "contract_versions_revoked_by_idx" ON "contract_versions"("revoked_by");

INSERT INTO "permissions" ("id", "key", "description", "resource", "action", "updated_at")
VALUES
  (gen_random_uuid(), 'contracts.sign_company', 'Sign contracts for the company', 'contracts', 'sign_company', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.sign_client.manage', 'Manage client signature links', 'contracts', 'sign_client.manage', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.signature.view', 'View contract signature details', 'contracts', 'signature.view', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.signature.revoke', 'Revoke contract signatures', 'contracts', 'signature.revoke', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.signature.history', 'View contract signature history', 'contracts', 'signature.history', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contracts.pdf.signed.download', 'Download signed contract PDFs', 'contracts', 'pdf.signed.download', CURRENT_TIMESTAMP)
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
  AND p."key" IN (
    'contracts.sign_company',
    'contracts.sign_client.manage',
    'contracts.signature.view',
    'contracts.signature.revoke',
    'contracts.signature.history',
    'contracts.pdf.signed.download'
  )
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope" = EXCLUDED."scope";

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope")
SELECT r."id", p."id", 'OWN'::"PermissionScope"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" = 'EMPLOYEE'
  AND p."key" IN (
    'contracts.signature.view',
    'contracts.signature.history',
    'contracts.pdf.signed.download'
  )
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope" = EXCLUDED."scope";
