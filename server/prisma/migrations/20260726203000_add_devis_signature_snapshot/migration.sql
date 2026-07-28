ALTER TABLE "devis"
  ADD COLUMN "is_signed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "signed_at" TIMESTAMP(3),
  ADD COLUMN "signed_by" UUID,
  ADD COLUMN "signature_url" VARCHAR(500),
  ADD COLUMN "stamp_url" VARCHAR(500);

CREATE INDEX "devis_signed_by_idx" ON "devis"("signed_by");

ALTER TABLE "devis"
  ADD CONSTRAINT "devis_signed_by_fkey"
  FOREIGN KEY ("signed_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO permissions (id, key, description, resource, action, created_at, updated_at)
VALUES (gen_random_uuid(), 'devis.sign', 'Sign and stamp quotes', 'devis', 'sign', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id,
  CASE WHEN r.name = 'ADMIN' THEN 'ALL'::"PermissionScope" ELSE 'OWN'::"PermissionScope" END
FROM roles r
JOIN permissions p ON p.key = 'devis.sign'
WHERE r.name IN ('ADMIN', 'EMPLOYEE')
ON CONFLICT (role_id, permission_id) DO NOTHING;
