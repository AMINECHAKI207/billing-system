CREATE TYPE "PermissionScope" AS ENUM ('ALL', 'OWN', 'SELECTED');

ALTER TABLE "role_permissions"
ADD COLUMN "scope" "PermissionScope" NOT NULL DEFAULT 'ALL';

CREATE TABLE "user_client_assignments" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_client_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_client_assignments_user_id_client_id_key"
ON "user_client_assignments"("user_id", "client_id");
CREATE INDEX "user_client_assignments_user_id_idx" ON "user_client_assignments"("user_id");
CREATE INDEX "user_client_assignments_client_id_idx" ON "user_client_assignments"("client_id");

ALTER TABLE "user_client_assignments"
ADD CONSTRAINT "user_client_assignments_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_client_assignments"
ADD CONSTRAINT "user_client_assignments_client_id_fkey"
FOREIGN KEY ("client_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
