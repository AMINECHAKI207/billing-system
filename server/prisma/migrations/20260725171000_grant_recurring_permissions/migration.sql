-- Seed recurring billing permissions after Dynamic RBAC has added role_permissions.scope.
INSERT INTO "permissions" ("id","key","description","resource","action","created_at","updated_at") VALUES
(gen_random_uuid(),'recurring.view','Consulter les plans recurrents','recurring','view',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
(gen_random_uuid(),'recurring.create','Creer des plans recurrents','recurring','create',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
(gen_random_uuid(),'recurring.update','Modifier ou suspendre les plans recurrents','recurring','update',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
(gen_random_uuid(),'recurring.run','Executer manuellement un plan recurrent','recurring','run',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id","permission_id","scope","assigned_at")
SELECT r.id,p.id,'ALL',CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name='ADMIN' AND p.key LIKE 'recurring.%'
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope"='ALL';

INSERT INTO "role_permissions" ("role_id","permission_id","scope","assigned_at")
SELECT r.id,p.id,'OWN',CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name='EMPLOYEE' AND p.key IN ('recurring.view','recurring.create','recurring.update','recurring.run')
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET "scope"='OWN';
