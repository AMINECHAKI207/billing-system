UPDATE "credit_note_reasons"
SET
  "description" = CASE "code"
    WHEN 'BILLING_ERROR' THEN 'Correction for an incorrect invoice amount, reference, or billing information.'
    WHEN 'PRICE_CORRECTION' THEN 'Correction applied because the invoiced price was incorrect.'
    WHEN 'QUANTITY_CORRECTION' THEN 'Correction applied because the invoiced quantity was incorrect.'
    WHEN 'PRODUCT_RETURN' THEN 'Credit note issued after returned goods.'
    WHEN 'SERVICE_CANCELLATION' THEN 'Credit note issued after a cancelled service.'
    WHEN 'DUPLICATE_INVOICE' THEN 'Credit note issued to reverse a duplicate invoice.'
    WHEN 'COMMERCIAL_DISCOUNT' THEN 'Commercial gesture or discount granted after invoicing.'
    WHEN 'CUSTOMER_REFUND' THEN 'Credit note linked to an amount to refund to the customer.'
    WHEN 'ORDER_CANCELLATION' THEN 'Credit note issued after order cancellation.'
    WHEN 'TAX_CORRECTION' THEN 'Correction of VAT or tax calculation.'
    WHEN 'DELIVERY_PROBLEM' THEN 'Credit note issued due to a delivery issue.'
    WHEN 'OTHER' THEN 'Other reason requiring a detailed explanation.'
    ELSE "description"
  END,
  "is_active" = true,
  "is_system" = true,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "code" IN (
  'BILLING_ERROR',
  'PRICE_CORRECTION',
  'QUANTITY_CORRECTION',
  'PRODUCT_RETURN',
  'SERVICE_CANCELLATION',
  'DUPLICATE_INVOICE',
  'COMMERCIAL_DISCOUNT',
  'CUSTOMER_REFUND',
  'ORDER_CANCELLATION',
  'TAX_CORRECTION',
  'DELIVERY_PROBLEM',
  'OTHER'
);

INSERT INTO "credit_note_reasons" ("code", "name_fr", "name_en", "name_ar", "description", "category", "is_system", "is_active", "requires_comment", "sort_order")
VALUES
  ('BILLING_ERROR', 'Erreur de facturation', 'Billing error', 'خطأ في الفوترة', 'Correction for an incorrect invoice amount, reference, or billing information.', 'CORRECTION', true, true, true, 10),
  ('PRICE_CORRECTION', 'Correction de prix', 'Price correction', 'تصحيح السعر', 'Correction applied because the invoiced price was incorrect.', 'CORRECTION', true, true, true, 20),
  ('QUANTITY_CORRECTION', 'Correction de quantité', 'Quantity correction', 'تصحيح الكمية', 'Correction applied because the invoiced quantity was incorrect.', 'CORRECTION', true, true, true, 30),
  ('PRODUCT_RETURN', 'Retour de produit', 'Product return', 'إرجاع منتج', 'Credit note issued after returned goods.', 'RETURN', true, true, false, 40),
  ('SERVICE_CANCELLATION', 'Annulation de service', 'Service cancellation', 'إلغاء خدمة', 'Credit note issued after a cancelled service.', 'CANCELLATION', true, true, false, 50),
  ('DUPLICATE_INVOICE', 'Facture en double', 'Duplicate invoice', 'فاتورة مكررة', 'Credit note issued to reverse a duplicate invoice.', 'CORRECTION', true, true, true, 60),
  ('COMMERCIAL_DISCOUNT', 'Remise commerciale', 'Commercial discount', 'خصم تجاري', 'Commercial gesture or discount granted after invoicing.', 'COMMERCIAL', true, true, false, 70),
  ('CUSTOMER_REFUND', 'Remboursement client', 'Customer refund', 'استرداد للعميل', 'Credit note linked to an amount to refund to the customer.', 'REFUND', true, true, false, 80),
  ('ORDER_CANCELLATION', 'Annulation de commande', 'Order cancellation', 'إلغاء الطلب', 'Credit note issued after order cancellation.', 'CANCELLATION', true, true, false, 90),
  ('TAX_CORRECTION', 'Correction de TVA', 'Tax correction', 'تصحيح الضريبة', 'Correction of VAT or tax calculation.', 'CORRECTION', true, true, true, 100),
  ('DELIVERY_PROBLEM', 'Problème de livraison', 'Delivery issue', 'مشكلة في التسليم', 'Credit note issued due to a delivery issue.', 'DELIVERY', true, true, true, 110),
  ('OTHER', 'Autre', 'Other', 'آخر', 'Other reason requiring a detailed explanation.', 'OTHER', true, true, true, 120)
ON CONFLICT ("code") DO UPDATE SET
  "name_fr" = EXCLUDED."name_fr",
  "name_en" = EXCLUDED."name_en",
  "name_ar" = EXCLUDED."name_ar",
  "description" = EXCLUDED."description",
  "category" = EXCLUDED."category",
  "is_system" = true,
  "is_active" = true,
  "requires_comment" = EXCLUDED."requires_comment",
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope", "assigned_at")
SELECT r."id", p."id", 'ALL', CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."key" IN (
  'credit_notes.pdf.preview',
  'credit_notes.pdf.print',
  'credit_note_reasons.view',
  'credit_note_reasons.manage'
)
WHERE r."name" = 'ADMIN'
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope" = 'ALL';
