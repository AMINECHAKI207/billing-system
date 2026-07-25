-- Create a per-year invoice sequence so invoice numbers are generated atomically.
CREATE TABLE "invoice_sequences" (
    "year" INTEGER NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("year")
);

-- Initialize each year from existing invoice numbers like INV-2026-0001.
INSERT INTO "invoice_sequences" ("year", "next_number")
SELECT
    CAST(SUBSTRING("invoice_number" FROM 5 FOR 4) AS INTEGER) AS "year",
    MAX(CAST(SUBSTRING("invoice_number" FROM 10) AS INTEGER)) + 1 AS "next_number"
FROM "invoices"
WHERE "invoice_number" ~ '^INV-[0-9]{4}-[0-9]+$'
GROUP BY CAST(SUBSTRING("invoice_number" FROM 5 FOR 4) AS INTEGER)
ON CONFLICT ("year") DO UPDATE SET
    "next_number" = GREATEST("invoice_sequences"."next_number", EXCLUDED."next_number"),
    "updated_at" = CURRENT_TIMESTAMP;
