INSERT INTO "permissions" ("id", "key", "description", "resource", "action", "updated_at") VALUES
  (gen_random_uuid(), 'products.view', 'Consulter le catalogue', 'products', 'view', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'products.create', 'Creer des produits', 'products', 'create', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'products.update', 'Modifier des produits', 'products', 'update', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'reminders.view', 'Consulter les relances', 'reminders', 'view', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'reminders.create', 'Creer des relances', 'reminders', 'create', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'reminders.manage', 'Executer les relances automatiques', 'reminders', 'manage', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."name" = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'products.view', 'reminders.view', 'reminders.create'
)
WHERE r."name" = 'EMPLOYEE'
ON CONFLICT DO NOTHING;
