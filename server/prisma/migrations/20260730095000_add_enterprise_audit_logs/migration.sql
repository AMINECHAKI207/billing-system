-- Enterprise centralized immutable audit logs
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "module" VARCHAR(80) NOT NULL,
  "entity" VARCHAR(120) NOT NULL,
  "entity_id" VARCHAR(120),
  "action" VARCHAR(80) NOT NULL,
  "old_values" JSONB,
  "new_values" JSONB,
  "metadata" JSONB,
  "ip_address" VARCHAR(80),
  "user_agent" VARCHAR(500),
  "browser" VARCHAR(120),
  "operating_system" VARCHAR(120),
  "device" VARCHAR(120),
  "request_id" VARCHAR(120),
  "session_id" VARCHAR(120),
  "http_method" VARCHAR(12),
  "route" VARCHAR(500),
  "status_code" INTEGER,
  "success" BOOLEAN NOT NULL DEFAULT true,
  "execution_time" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_module_idx" ON "audit_logs"("module");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs"("entity");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_id_idx" ON "audit_logs"("entity_id");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_module_entity_entity_id_idx" ON "audit_logs"("module", "entity", "entity_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_user_id_fkey'
  ) THEN
    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.user_id IS NULL
    AND OLD.user_id IS NOT NULL
    AND NEW.id = OLD.id
    AND NEW.module = OLD.module
    AND NEW.entity = OLD.entity
    AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
    AND NEW.action = OLD.action
    AND NEW.old_values IS NOT DISTINCT FROM OLD.old_values
    AND NEW.new_values IS NOT DISTINCT FROM OLD.new_values
    AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
    AND NEW.ip_address IS NOT DISTINCT FROM OLD.ip_address
    AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
    AND NEW.browser IS NOT DISTINCT FROM OLD.browser
    AND NEW.operating_system IS NOT DISTINCT FROM OLD.operating_system
    AND NEW.device IS NOT DISTINCT FROM OLD.device
    AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id
    AND NEW.session_id IS NOT DISTINCT FROM OLD.session_id
    AND NEW.http_method IS NOT DISTINCT FROM OLD.http_method
    AND NEW.route IS NOT DISTINCT FROM OLD.route
    AND NEW.status_code IS NOT DISTINCT FROM OLD.status_code
    AND NEW.success = OLD.success
    AND NEW.execution_time IS NOT DISTINCT FROM OLD.execution_time
    AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Audit logs are immutable';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'audit_logs_no_update'
  ) THEN
    CREATE TRIGGER audit_logs_no_update
    BEFORE UPDATE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'audit_logs_no_delete'
  ) THEN
    CREATE TRIGGER audit_logs_no_delete
    BEFORE DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
  END IF;
END;
$$;

WITH input_permissions(key, description, resource, action) AS (
  VALUES
    ('audit_logs.view', 'View enterprise audit logs', 'audit_logs', 'view'),
    ('audit_logs.export', 'Export enterprise audit logs', 'audit_logs', 'export')
), inserted_permissions AS (
  INSERT INTO "permissions" ("id", "key", "description", "resource", "action", "created_at", "updated_at")
  SELECT gen_random_uuid(), key, description, resource, action, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM input_permissions
  ON CONFLICT ("key") DO UPDATE SET
    "description" = EXCLUDED."description",
    "resource" = EXCLUDED."resource",
    "action" = EXCLUDED."action",
    "updated_at" = CURRENT_TIMESTAMP
  RETURNING "id", "key"
), admin_role AS (
  SELECT "id" FROM "roles" WHERE "name" = 'ADMIN'
)
INSERT INTO "role_permissions" ("role_id", "permission_id", "scope")
SELECT admin_role."id", inserted_permissions."id", 'ALL'
FROM admin_role, inserted_permissions
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope" = EXCLUDED."scope";
