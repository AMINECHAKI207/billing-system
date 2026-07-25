# Sprint 1 — Theme and RBAC hardening

## Theme
- Applies the saved theme before React renders to prevent the light-mode flash.
- Keeps the `dark` class, `data-theme`, and browser `color-scheme` synchronized.
- Synchronizes theme changes across browser tabs through the `storage` event.
- Keeps local device preference authoritative over the server preference.
- Removed a duplicated React state declaration that could break TypeScript compilation.

## Dynamic RBAC
- Removed an unsafe Prisma type cast from SELECTED client scope filtering.
- Added an explicit rejection path for unsupported permission scope values.
- Existing ALL / OWN / SELECTED inheritance remains active for customers, invoices, and payments.

## Validation note
Dependency installation could not be executed in the build container, so run the normal build on Windows:

```powershell
npm install
npm run db:generate
npm run build
npm run dev
```
