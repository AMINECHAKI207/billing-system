CREATE TABLE "invoice_email_logs" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "sent_by" UUID,
    "recipient_email" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "delivery_mode" VARCHAR(30),
    "message_id" VARCHAR(255),
    "file_path" VARCHAR(1000),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_email_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_email_logs_invoice_id_idx" ON "invoice_email_logs"("invoice_id");
CREATE INDEX "invoice_email_logs_status_idx" ON "invoice_email_logs"("status");
CREATE INDEX "invoice_email_logs_created_at_idx" ON "invoice_email_logs"("created_at");

ALTER TABLE "invoice_email_logs"
ADD CONSTRAINT "invoice_email_logs_invoice_id_fkey"
FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_email_logs"
ADD CONSTRAINT "invoice_email_logs_sent_by_fkey"
FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
