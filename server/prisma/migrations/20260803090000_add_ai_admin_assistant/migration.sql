CREATE TYPE "AiConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL', 'SYSTEM');
CREATE TYPE "AiActionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXECUTED', 'CANCELLED', 'EXPIRED', 'FAILED');
CREATE TYPE "AiToolRiskLevel" AS ENUM ('READ_ONLY', 'CONFIRMATION_REQUIRED', 'REAUTH_REQUIRED');

CREATE TABLE "ai_conversations" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "title" VARCHAR(255),
  "status" "AiConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "language" VARCHAR(10) NOT NULL DEFAULT 'fr',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "role" "AiMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "sanitized_content" TEXT,
  "tool_name" VARCHAR(120),
  "tool_call_id" VARCHAR(120),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_pending_actions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "tool_name" VARCHAR(120) NOT NULL,
  "input_payload" JSONB NOT NULL,
  "preview_payload" JSONB NOT NULL,
  "risk_level" "AiToolRiskLevel" NOT NULL,
  "required_permission" VARCHAR(120) NOT NULL,
  "status" "AiActionStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" VARCHAR(160) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "confirmed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "executed_at" TIMESTAMP(3),
  "result_payload" JSONB,
  "error_payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_pending_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_conversations_user_id_created_at_idx" ON "ai_conversations"("user_id", "created_at");
CREATE INDEX "ai_conversations_status_idx" ON "ai_conversations"("status");
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");
CREATE INDEX "ai_messages_tool_name_idx" ON "ai_messages"("tool_name");
CREATE UNIQUE INDEX "ai_pending_actions_idempotency_key_key" ON "ai_pending_actions"("idempotency_key");
CREATE INDEX "ai_pending_actions_user_id_status_expires_at_idx" ON "ai_pending_actions"("user_id", "status", "expires_at");
CREATE INDEX "ai_pending_actions_conversation_id_idx" ON "ai_pending_actions"("conversation_id");
CREATE INDEX "ai_pending_actions_tool_name_idx" ON "ai_pending_actions"("tool_name");

ALTER TABLE "ai_conversations"
  ADD CONSTRAINT "ai_conversations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_pending_actions"
  ADD CONSTRAINT "ai_pending_actions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_pending_actions"
  ADD CONSTRAINT "ai_pending_actions_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description", "resource", "action", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'ai_assistant.access', 'Access the secure AI admin assistant', 'ai_assistant', 'access', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ai_assistant.use_read_tools', 'Use read-only AI assistant tools', 'ai_assistant', 'use_read_tools', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ai_assistant.use_write_tools', 'Prepare AI assistant actions requiring confirmation', 'ai_assistant', 'use_write_tools', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ai_assistant.confirm_actions', 'Confirm pending AI assistant actions', 'ai_assistant', 'confirm_actions', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ai_assistant.view_history', 'View AI assistant conversation history', 'ai_assistant', 'view_history', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ai_assistant.manage_tools', 'Manage AI assistant tool access', 'ai_assistant', 'manage_tools', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope", "assigned_at")
SELECT r."id", p."id", 'ALL', CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."resource" = 'ai_assistant'
WHERE r."name" = 'ADMIN'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
