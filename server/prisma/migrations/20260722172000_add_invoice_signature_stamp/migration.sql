ALTER TABLE "company_settings"
ADD COLUMN "signature_url" VARCHAR(500),
ADD COLUMN "stamp_url" VARCHAR(500);

ALTER TABLE "invoices"
ADD COLUMN "is_signed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "signed_at" TIMESTAMP(3),
ADD COLUMN "signed_by" UUID,
ADD COLUMN "signature_url" VARCHAR(500),
ADD COLUMN "stamp_url" VARCHAR(500);

ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_signed_by_fkey"
FOREIGN KEY ("signed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "invoices_signed_by_idx" ON "invoices"("signed_by");
