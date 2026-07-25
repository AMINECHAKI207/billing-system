CREATE TABLE "company_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" VARCHAR(255) NOT NULL,
    "address" TEXT,
    "phone" VARCHAR(50),
    "email" VARCHAR(255),
    "tax_number" VARCHAR(100),
    "logo_url" VARCHAR(500),
    "default_currency" VARCHAR(10) NOT NULL DEFAULT 'MAD',
    "default_tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "payment_terms" TEXT,
    "bank_details" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "company_settings" (
    "id",
    "name",
    "address",
    "phone",
    "email",
    "tax_number",
    "default_currency",
    "default_tax_rate",
    "payment_terms"
) VALUES (
    1,
    'Billing System Demo',
    'Casablanca, Morocco',
    '+212 600 000 000',
    'billing@example.com',
    'IF: DEMO',
    'MAD',
    20,
    'Paiement a 30 jours.'
) ON CONFLICT ("id") DO NOTHING;
