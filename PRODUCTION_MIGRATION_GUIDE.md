# Production migration guide

This version keeps the full Sprint 1 source and adds recurring billing without deleting application source files.
`node_modules`, build output and log files are intentionally not required source code and must be regenerated on each machine.

## First installation on a clean database

```powershell
npm install
npm run db:generate
npm run db:status
npm run db:migrate
npm run db:seed   # development/demo data only; do not run on production data
npm run build
npm run dev
```

## Existing database with real data

1. Back up PostgreSQL first.
2. Do not use `prisma db push --force-reset` and do not use `prisma migrate reset`.
3. Run:

```powershell
npm install
npm run db:generate
npm run db:status
npm run db:migrate:prod
npm run build
```

The recurring migration was split into two safe steps:

- `20260725170000_add_recurring_billing`: creates recurring tables and invoice relation.
- `20260725171000_grant_recurring_permissions`: grants permissions only after Dynamic RBAC has created `role_permissions.scope`.

This fixes Prisma error `P3006: column scope of relation role_permissions does not exist` on the shadow database.

## If the previous broken migration was only attempted

Usually no repair is needed; rerun `npm run db:migrate` after replacing the project with this version.
Use `npm run db:status` first. Never delete real data to solve a migration-order problem.
