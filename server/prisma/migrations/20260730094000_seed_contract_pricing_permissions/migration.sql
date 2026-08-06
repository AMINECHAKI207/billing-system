WITH input_permissions(key, description, resource, action) AS (
  VALUES
    ('contracts.pricing.view', 'View contract pricing and billing configuration', 'contracts', 'pricing.view'),
    ('contracts.pricing.manage', 'Manage contract pricing and billing configuration', 'contracts', 'pricing.manage'),
    ('contracts.billing.view', 'View contract billing state and linked invoices', 'contracts', 'billing.view'),
    ('contracts.billing.generate', 'Generate invoices from contracts', 'contracts', 'billing.generate'),
    ('contracts.billing.retry', 'Retry failed contract billing jobs', 'contracts', 'billing.retry'),
    ('contracts.time_entries.view', 'View contract time entries', 'contracts', 'time_entries.view'),
    ('contracts.time_entries.create', 'Create contract time entries', 'contracts', 'time_entries.create'),
    ('contracts.time_entries.approve', 'Approve contract time entries', 'contracts', 'time_entries.approve'),
    ('contracts.milestones.manage', 'Manage contract milestones', 'contracts', 'milestones.manage')
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
