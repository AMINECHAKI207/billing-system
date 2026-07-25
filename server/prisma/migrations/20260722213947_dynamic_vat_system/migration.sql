-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "morocco_vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 20,
ADD COLUMN     "vat_enabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "customers" SET "country" = 'Morocco' WHERE "country" IS NULL OR trim("country") = '';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "country_code" VARCHAR(2) NOT NULL DEFAULT 'MA',
ALTER COLUMN "country" SET NOT NULL,
ALTER COLUMN "country" SET DEFAULT 'Morocco';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "customer_country" VARCHAR(100) NOT NULL DEFAULT 'Morocco',
ADD COLUMN     "customer_country_code" VARCHAR(2) NOT NULL DEFAULT 'MA',
ADD COLUMN     "vat_overridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vat_overridden_at" TIMESTAMP(3),
ADD COLUMN     "vat_overridden_by" UUID,
ADD COLUMN     "vat_override_reason" VARCHAR(500);

-- CreateIndex
CREATE INDEX "invoices_vat_overridden_by_idx" ON "invoices"("vat_overridden_by");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vat_overridden_by_fkey" FOREIGN KEY ("vat_overridden_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
