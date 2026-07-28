INSERT INTO "permissions" ("id", "key", "description", "resource", "action", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'invoices.send', 'Envoyer les factures par email', 'invoices', 'send', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope", "assigned_at")
SELECT r."id", p."id", 'ALL'::"PermissionScope", CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."key" = 'invoices.send'
WHERE r."name" = 'ADMIN'
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope" = 'ALL';

INSERT INTO "role_permissions" ("role_id", "permission_id", "scope", "assigned_at")
SELECT r."id", p."id", 'OWN'::"PermissionScope", CURRENT_TIMESTAMP
FROM "roles" r
JOIN "permissions" p ON p."key" = 'invoices.send'
WHERE r."name" = 'EMPLOYEE'
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope" = 'OWN';
