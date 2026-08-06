UPDATE "role_permissions" rp
SET "scope" = 'SELECTED'::"PermissionScope"
FROM "roles" r
JOIN "permissions" p ON p."key" IN (
  'contracts.time_entries.view',
  'contracts.time_entries.create',
  'contracts.time_entries.update',
  'contracts.time_entries.submit'
)
WHERE rp."role_id" = r."id"
  AND rp."permission_id" = p."id"
  AND r."name" = 'EMPLOYEE';
