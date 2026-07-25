ALTER TABLE "users" ADD COLUMN "rbac_role_id" UUID;

CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "resource" VARCHAR(80) NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");
CREATE INDEX "users_rbac_role_id_idx" ON "users"("rbac_role_id");

ALTER TABLE "users" ADD CONSTRAINT "users_rbac_role_id_fkey"
  FOREIGN KEY ("rbac_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey"
  FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "roles" ("id", "name", "description", "is_system", "updated_at") VALUES
  ('00000000-0000-0000-0000-000000000001', 'ADMIN', 'Acces complet a l application', true, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000002', 'EMPLOYEE', 'Acces operationnel selon permissions', true, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "permissions" ("id", "key", "description", "resource", "action", "updated_at") VALUES
  (gen_random_uuid(), 'users.view', 'Consulter les utilisateurs', 'users', 'view', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'users.create', 'Creer des utilisateurs', 'users', 'create', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'users.update', 'Modifier des utilisateurs', 'users', 'update', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'users.delete', 'Desactiver des utilisateurs', 'users', 'delete', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'roles.view', 'Consulter les roles', 'roles', 'view', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'roles.create', 'Creer des roles', 'roles', 'create', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'roles.update', 'Modifier des roles', 'roles', 'update', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'roles.delete', 'Supprimer des roles', 'roles', 'delete', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'permissions.view', 'Consulter les permissions', 'permissions', 'view', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'permissions.assign', 'Attribuer des permissions', 'permissions', 'assign', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'clients.view', 'Consulter les clients', 'clients', 'view', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'clients.create', 'Creer des clients', 'clients', 'create', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'clients.update', 'Modifier des clients', 'clients', 'update', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'clients.delete', 'Supprimer des clients', 'clients', 'delete', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'invoices.view', 'Consulter les factures', 'invoices', 'view', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'invoices.create', 'Creer des factures', 'invoices', 'create', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'invoices.update', 'Modifier des factures', 'invoices', 'update', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'invoices.delete', 'Supprimer des factures', 'invoices', 'delete', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'invoices.sign', 'Signer des factures', 'invoices', 'sign', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'invoices.override_vat', 'Modifier la TVA manuellement', 'invoices', 'override_vat', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'payments.view', 'Consulter les paiements', 'payments', 'view', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'payments.create', 'Enregistrer des paiements', 'payments', 'create', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'reports.view', 'Consulter les rapports', 'reports', 'view', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'settings.view', 'Consulter les parametres', 'settings', 'view', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'settings.update', 'Modifier les parametres', 'settings', 'update', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'dashboard.view', 'Consulter le dashboard', 'dashboard', 'view', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."name" = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'dashboard.view', 'clients.view', 'clients.create', 'clients.update',
  'invoices.view', 'invoices.create', 'invoices.update', 'payments.view',
  'payments.create', 'reports.view', 'settings.view'
)
WHERE r."name" = 'EMPLOYEE'
ON CONFLICT DO NOTHING;

UPDATE "users" u
SET "rbac_role_id" = r."id"
FROM "roles" r
WHERE r."name" = u."role"::text AND u."rbac_role_id" IS NULL;
