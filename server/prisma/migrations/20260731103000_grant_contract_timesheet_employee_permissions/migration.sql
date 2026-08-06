INSERT INTO "role_permissions" ("role_id", "permission_id", "scope", "assigned_at")
SELECT r."id", p."id", 'SELECTED'::"PermissionScope", CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."key" IN (
  'contracts.time_entries.view',
  'contracts.time_entries.create',
  'contracts.time_entries.update',
  'contracts.time_entries.submit'
)
WHERE r."name" = 'EMPLOYEE'
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope" = EXCLUDED."scope";
