CREATE TABLE "telegram_sessions" (
  "id" UUID NOT NULL,
  "telegram_user_id" VARCHAR(50) NOT NULL,
  "telegram_chat_id" VARCHAR(50) NOT NULL,
  "user_id" UUID,
  "conversation_id" UUID,
  "language" VARCHAR(10) NOT NULL DEFAULT 'fr',
  "awaiting_email" BOOLEAN NOT NULL DEFAULT false,
  "pending_tool_name" VARCHAR(120),
  "pending_form_values" JSONB,
  "pending_missing_fields" JSONB,
  "pending_fields" JSONB,
  "state_expires_at" TIMESTAMP(3),
  "last_code_requested_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "last_interaction_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "telegram_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_sessions_telegram_chat_id_key" ON "telegram_sessions"("telegram_chat_id");
CREATE INDEX "telegram_sessions_telegram_user_id_idx" ON "telegram_sessions"("telegram_user_id");
CREATE INDEX "telegram_sessions_user_id_idx" ON "telegram_sessions"("user_id");
CREATE INDEX "telegram_sessions_state_expires_at_idx" ON "telegram_sessions"("state_expires_at");

ALTER TABLE "telegram_sessions"
ADD CONSTRAINT "telegram_sessions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
