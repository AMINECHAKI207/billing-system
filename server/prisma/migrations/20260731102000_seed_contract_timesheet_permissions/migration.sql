WITH input_permissions(key, description, resource, action) AS (
  VALUES
    ('contracts.time_entries.update', 'Update draft or rejected contract time entries', 'contracts', 'time_entries.update'),
    ('contracts.time_entries.submit', 'Submit contract time entries for approval', 'contracts', 'time_entries.submit'),
    ('contracts.time_entries.reject', 'Reject submitted contract time entries', 'contracts', 'time_entries.reject')
), inserted AS (
  INSERT INTO "permissions" ("id", "key", "description", "resource", "action", "created_at", "updated_at")
  SELECT gen_random_uuid(), key, description, resource, action, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM input_permissions
  ON CONFLICT ("key") DO UPDATE SET
    "description" = EXCLUDED."description",
    "resource" = EXCLUDED."resource",
    "action" = EXCLUDED."action",
    "updated_at" = CURRENT_TIMESTAMP
  RETURNING "id", "key"
)
INSERT INTO "role_permissions" ("role_id", "permission_id", "scope", "assigned_at")
SELECT r."id", p."id", 'ALL'::"PermissionScope", CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."key" IN (SELECT key FROM input_permissions)
WHERE r."name" = 'ADMIN'
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope" = EXCLUDED."scope";
