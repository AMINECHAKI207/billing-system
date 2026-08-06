WITH repaired AS (
  SELECT
    cv."id",
    cv."contract_id",
    cv."signed_pdf_hash",
    cv."previous_pdf_hash",
    cv."company_signed_at",
    cv."client_signed_at"
  FROM "contract_versions" cv
  JOIN "contracts" c ON c."current_version_id" = cv."id"
  WHERE cv."signature_status" = 'NOT_STARTED'::"ContractSignatureStatus"
    AND cv."revocation_reason" = 'Legacy inconsistent signature state repaired without fabricating signature evidence'
    AND (
      cv."signed_pdf_hash" IS NOT NULL
      OR cv."signed_pdf_storage_key" IS NOT NULL
      OR cv."company_signed_at" IS NOT NULL
      OR cv."client_signed_at" IS NOT NULL
      OR cv."client_signer_name" IS NOT NULL
      OR cv."client_signer_email" IS NOT NULL
      OR c."signed_version_id" IS NOT NULL
      OR c."pdf_hash" IS NOT NULL
    )
),
updated_versions AS (
  UPDATE "contract_versions" cv
  SET
    "previous_pdf_hash" = COALESCE(cv."previous_pdf_hash", cv."signed_pdf_hash"),
    "signed_pdf_hash" = NULL,
    "signed_pdf_storage_key" = NULL,
    "company_signed_by" = NULL,
    "company_signed_at" = NULL,
    "client_signer_name" = NULL,
    "client_signer_email" = NULL,
    "client_signed_at" = NULL,
    "is_signed" = false
  FROM repaired r
  WHERE cv."id" = r."id"
  RETURNING cv."contract_id", cv."id" AS "version_id", r."signed_pdf_hash", r."company_signed_at", r."client_signed_at"
),
updated_contracts AS (
  UPDATE "contracts" c
  SET
    "signed_version_id" = NULL,
    "company_signed_by" = NULL,
    "signed_at" = NULL,
    "pdf_hash" = NULL
  FROM updated_versions uv
  WHERE c."id" = uv."contract_id"
  RETURNING c."id", uv."version_id", uv."signed_pdf_hash", uv."company_signed_at", uv."client_signed_at"
)
INSERT INTO "contract_audit_logs" ("id", "contract_id", "action", "previous_values", "new_values", "created_at")
SELECT
  gen_random_uuid(),
  uc."id",
  'LEGACY_SIGNATURE_EVIDENCE_CLEARED',
  jsonb_build_object(
    'versionId', uc."version_id",
    'signedPdfHash', uc."signed_pdf_hash",
    'companySignedAt', uc."company_signed_at",
    'clientSignedAt', uc."client_signed_at"
  ),
  jsonb_build_object(
    'signatureStatus', 'NOT_STARTED',
    'note', 'Cleared active signature evidence fields after legacy repair; previous hash preserved on version'
  ),
  CURRENT_TIMESTAMP
FROM updated_contracts uc
WHERE NOT EXISTS (
  SELECT 1
  FROM "contract_audit_logs" existing
  WHERE existing."contract_id" = uc."id"
    AND existing."action" = 'LEGACY_SIGNATURE_EVIDENCE_CLEARED'
);
