WITH inconsistent AS (
  SELECT
    c."id",
    c."contract_number",
    c."status" AS "old_status",
    c."sent_at",
    c."viewed_at",
    c."start_date",
    c."end_date",
    c."signed_version_id",
    c."pdf_hash",
    cv."id" AS "version_id",
    cv."signature_status" AS "old_signature_status",
    cv."is_signed",
    cv."company_signature_url",
    cv."company_stamp_url",
    cv."company_signed_at",
    cv."client_signed_at",
    cv."signed_pdf_hash",
    cv."signed_pdf_storage_key",
    (
      cv."id" IS NOT NULL
      AND cv."signature_status" = 'COMPLETED'::"ContractSignatureStatus"
      AND cv."is_signed" = true
      AND cv."company_signature_url" IS NOT NULL
      AND cv."company_stamp_url" IS NOT NULL
      AND cv."company_signed_at" IS NOT NULL
      AND cv."client_signed_at" IS NOT NULL
      AND cv."signed_pdf_hash" IS NOT NULL
      AND cv."signed_pdf_storage_key" IS NOT NULL
      AND c."signed_version_id" = cv."id"
      AND c."pdf_hash" IS NOT NULL
    ) AS "has_complete_evidence"
  FROM "contracts" c
  LEFT JOIN "contract_versions" cv ON cv."id" = c."current_version_id"
  WHERE c."status" = 'SIGNED'::"ContractStatus"
     OR (
      c."status" = 'ACTIVE'::"ContractStatus"
      AND NOT (
        cv."id" IS NOT NULL
        AND cv."signature_status" = 'COMPLETED'::"ContractSignatureStatus"
        AND cv."is_signed" = true
        AND cv."company_signature_url" IS NOT NULL
        AND cv."company_stamp_url" IS NOT NULL
        AND cv."company_signed_at" IS NOT NULL
        AND cv."client_signed_at" IS NOT NULL
        AND cv."signed_pdf_hash" IS NOT NULL
        AND cv."signed_pdf_storage_key" IS NOT NULL
        AND c."signed_version_id" = cv."id"
        AND c."pdf_hash" IS NOT NULL
      )
    )
),
repaired_versions AS (
  UPDATE "contract_versions" cv
  SET
    "signature_status" = CASE
      WHEN i."has_complete_evidence" THEN 'COMPLETED'::"ContractSignatureStatus"
      ELSE 'NOT_STARTED'::"ContractSignatureStatus"
    END,
    "is_signed" = CASE WHEN i."has_complete_evidence" THEN cv."is_signed" ELSE false END,
    "previous_pdf_hash" = COALESCE(cv."previous_pdf_hash", cv."signed_pdf_hash", i."pdf_hash"),
    "revocation_reason" = CASE
      WHEN i."has_complete_evidence" THEN cv."revocation_reason"
      ELSE COALESCE(cv."revocation_reason", 'Legacy inconsistent signature state repaired without fabricating signature evidence')
    END
  FROM inconsistent i
  WHERE cv."id" = i."version_id"
  RETURNING cv."id"
),
repaired_contracts AS (
  UPDATE "contracts" c
  SET
    "status" = CASE
      WHEN i."has_complete_evidence"
        AND (i."start_date" IS NULL OR i."start_date" <= CURRENT_DATE)
        AND (i."end_date" IS NULL OR i."end_date" >= CURRENT_DATE)
        THEN 'ACTIVE'::"ContractStatus"
      WHEN i."has_complete_evidence" THEN 'SENT'::"ContractStatus"
      WHEN i."sent_at" IS NOT NULL OR i."viewed_at" IS NOT NULL THEN 'SENT'::"ContractStatus"
      ELSE 'DRAFT'::"ContractStatus"
    END,
    "signed_version_id" = CASE WHEN i."has_complete_evidence" THEN c."signed_version_id" ELSE NULL END,
    "company_signed_by" = CASE WHEN i."has_complete_evidence" THEN c."company_signed_by" ELSE NULL END,
    "signed_at" = CASE WHEN i."has_complete_evidence" THEN c."signed_at" ELSE NULL END,
    "activated_at" = CASE
      WHEN i."has_complete_evidence"
        AND (i."start_date" IS NULL OR i."start_date" <= CURRENT_DATE)
        AND (i."end_date" IS NULL OR i."end_date" >= CURRENT_DATE)
        THEN COALESCE(c."activated_at", CURRENT_TIMESTAMP)
      ELSE c."activated_at"
    END,
    "pdf_hash" = CASE WHEN i."has_complete_evidence" THEN c."pdf_hash" ELSE NULL END
  FROM inconsistent i
  WHERE c."id" = i."id"
  RETURNING
    c."id",
    i."contract_number",
    i."old_status",
    i."old_signature_status",
    c."status" AS "new_status",
    i."version_id",
    i."has_complete_evidence"
)
INSERT INTO "contract_audit_logs" ("id", "contract_id", "action", "previous_values", "new_values", "created_at")
SELECT
  gen_random_uuid(),
  r."id",
  'LEGACY_STATUS_SIGNATURE_REPAIRED',
  jsonb_build_object(
    'contractNumber', r."contract_number",
    'status', r."old_status",
    'signatureStatus', r."old_signature_status",
    'versionId', r."version_id"
  ),
  jsonb_build_object(
    'status', r."new_status",
    'signatureStatus', CASE WHEN r."has_complete_evidence" THEN 'COMPLETED' ELSE 'NOT_STARTED' END,
    'hasCompleteEvidence', r."has_complete_evidence",
    'note', 'Repaired legacy contract SIGNED/ACTIVE inconsistency without creating signature evidence'
  ),
  CURRENT_TIMESTAMP
FROM repaired_contracts r
WHERE NOT EXISTS (
  SELECT 1
  FROM "contract_audit_logs" existing
  WHERE existing."contract_id" = r."id"
    AND existing."action" = 'LEGACY_STATUS_SIGNATURE_REPAIRED'
);
