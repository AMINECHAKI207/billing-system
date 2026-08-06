INSERT INTO "role_permissions" ("role_id", "permission_id", "scope", "assigned_at")
SELECT r."id", p."id", 'ALL', CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."key" = 'credit_note_reasons.view'
WHERE r."name" IN ('ADMIN', 'EMPLOYEE')
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope" = 'ALL';

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope", "assigned_at")
SELECT r."id", p."id", 'ALL', CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."key" = 'credit_note_reasons.manage'
WHERE r."name" = 'ADMIN'
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope" = 'ALL';
