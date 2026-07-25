# Dynamic RBAC

This version implements database-backed roles and permissions with per-permission scopes:

- `ALL`: access every client and all inherited invoices/payments.
- `OWN`: access clients created by the authenticated user.
- `SELECTED`: access clients explicitly assigned to the user.

## Included

- `PermissionScope` Prisma enum.
- `RolePermission.scope`.
- `UserClientAssignment` many-to-many assignment table.
- Strict `requirePermission` middleware that rejects missing grants and exposes permission scopes.
- Scope filtering for customers, invoices, payments, dashboard data and direct resource IDs.
- Admin API for assigning clients to users.
- Role UI for selecting scopes and assigning selected clients.

## Windows setup

```powershell
npm install
npm run db:generate
npm run db:migrate
npm run build
npm run dev
```

For a disposable development database, Prisma may ask to reset the schema when migration history differs. Back up important data before accepting a reset.
