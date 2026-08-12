CREATE TABLE "telegram_accounts" (
    "id" UUID NOT NULL,
    "telegram_user_id" VARCHAR(50) NOT NULL,
    "telegram_chat_id" VARCHAR(50) NOT NULL,
    "user_id" UUID NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_link_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_accounts_telegram_user_id_key"
ON "telegram_accounts"("telegram_user_id");

CREATE UNIQUE INDEX "telegram_accounts_user_id_key"
ON "telegram_accounts"("user_id");

CREATE INDEX "telegram_accounts_telegram_chat_id_idx"
ON "telegram_accounts"("telegram_chat_id");

CREATE UNIQUE INDEX "telegram_link_codes_code_key"
ON "telegram_link_codes"("code");

CREATE INDEX "telegram_link_codes_user_id_idx"
ON "telegram_link_codes"("user_id");

CREATE INDEX "telegram_link_codes_expires_at_idx"
ON "telegram_link_codes"("expires_at");

ALTER TABLE "telegram_accounts"
ADD CONSTRAINT "telegram_accounts_user_id_fkey"
FOREIGN KEY ("user_id")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "telegram_link_codes"
ADD CONSTRAINT "telegram_link_codes_user_id_fkey"
FOREIGN KEY ("user_id")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;