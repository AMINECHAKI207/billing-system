CREATE TABLE "credit_note_reasons" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(80) NOT NULL,
  "name_fr" VARCHAR(255) NOT NULL,
  "name_en" VARCHAR(255) NOT NULL,
  "name_ar" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "category" VARCHAR(80) NOT NULL DEFAULT 'GENERAL',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "requires_comment" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_note_reasons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_note_reasons_code_key" ON "credit_note_reasons"("code");
CREATE INDEX "credit_note_reasons_is_active_idx" ON "credit_note_reasons"("is_active");
CREATE INDEX "credit_note_reasons_category_idx" ON "credit_note_reasons"("category");
CREATE INDEX "credit_note_reasons_sort_order_idx" ON "credit_note_reasons"("sort_order");

ALTER TABLE "credit_note_reasons"
ADD CONSTRAINT "credit_note_reasons_created_by_fkey"
FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "credit_note_reasons" ("code", "name_fr", "name_en", "name_ar", "category", "is_system", "requires_comment", "sort_order")
VALUES
  ('BILLING_ERROR', 'Erreur de facturation', 'Billing error', 'خطأ في الفوترة', 'CORRECTION', true, true, 10),
  ('PRICE_CORRECTION', 'Correction de prix', 'Price correction', 'تصحيح السعر', 'CORRECTION', true, true, 20),
  ('QUANTITY_CORRECTION', 'Correction de quantité', 'Quantity correction', 'تصحيح الكمية', 'CORRECTION', true, true, 30),
  ('PRODUCT_RETURN', 'Retour de produit', 'Product return', 'إرجاع منتج', 'RETURN', true, false, 40),
  ('SERVICE_CANCELLATION', 'Annulation de service', 'Service cancellation', 'إلغاء خدمة', 'CANCELLATION', true, false, 50),
  ('DUPLICATE_INVOICE', 'Facture en double', 'Duplicate invoice', 'فاتورة مكررة', 'CORRECTION', true, true, 60),
  ('COMMERCIAL_DISCOUNT', 'Remise commerciale', 'Commercial discount', 'خصم تجاري', 'COMMERCIAL', true, false, 70),
  ('CUSTOMER_REFUND', 'Remboursement client', 'Customer refund', 'استرداد للعميل', 'REFUND', true, false, 80),
  ('ORDER_CANCELLATION', 'Annulation de commande', 'Order cancellation', 'إلغاء الطلب', 'CANCELLATION', true, false, 90),
  ('TAX_CORRECTION', 'Correction de TVA', 'Tax correction', 'تصحيح الضريبة', 'CORRECTION', true, true, 100),
  ('DELIVERY_PROBLEM', 'Problème de livraison', 'Delivery issue', 'مشكلة في التسليم', 'DELIVERY', true, true, 110),
  ('OTHER', 'Autre', 'Other', 'آخر', 'OTHER', true, true, 120)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "credit_notes"
ADD COLUMN "reason_id" UUID,
ADD COLUMN "reason_code_snapshot" VARCHAR(80) NOT NULL DEFAULT 'OTHER',
ADD COLUMN "reason_name_snapshot" JSONB NOT NULL DEFAULT '{}';

UPDATE "credit_notes"
SET
  "reason_id" = (SELECT "id" FROM "credit_note_reasons" WHERE "code" = 'OTHER' LIMIT 1),
  "reason_code_snapshot" = 'OTHER',
  "reason_name_snapshot" = jsonb_build_object('fr', 'Autre', 'en', 'Other', 'ar', 'آخر')
WHERE "reason_id" IS NULL;

ALTER TABLE "credit_notes"
ALTER COLUMN "reason_id" SET NOT NULL;

CREATE INDEX "credit_notes_reason_id_idx" ON "credit_notes"("reason_id");

ALTER TABLE "credit_notes"
ADD CONSTRAINT "credit_notes_reason_id_fkey"
FOREIGN KEY ("reason_id") REFERENCES "credit_note_reasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description", "resource", "action", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'credit_notes.pdf.preview', 'Preview credit note PDFs', 'credit_notes', 'pdf.preview', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'credit_notes.pdf.print', 'Print credit note PDFs', 'credit_notes', 'pdf.print', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'credit_note_reasons.view', 'View credit note reasons', 'credit_note_reasons', 'view', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'credit_note_reasons.manage', 'Manage credit note reasons', 'credit_note_reasons', 'manage', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope", "assigned_at")
SELECT r."id", p."id", 'ALL', CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."key" IN (
  'credit_notes.pdf.preview',
  'credit_notes.pdf.print',
  'credit_note_reasons.view',
  'credit_note_reasons.manage'
)
WHERE r."name" = 'Admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
