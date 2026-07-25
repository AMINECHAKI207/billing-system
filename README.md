# Billing System

Production-oriented billing and invoice management application built with React, TypeScript, Express, Prisma, and PostgreSQL.

## Implemented Modules

- Authentication: login, refresh token cookie, logout, current user, and password change.
- Authorization: database-backed RBAC with roles, granular permissions, role-permission assignments, and HttpOnly-cookie JWT authentication.
- Customers: create, list, search, update, detail view, financial summary, and admin-only deletion.
- Products: product/service catalog with active status and admin-only mutations.
- Invoices: create, edit, list, search, status changes, unique numbering, PDF export, and email sending.
- Dynamic VAT: company VAT settings, mandatory customer country/code, automatic Morocco VAT, foreign VAT 0%, audited admin overrides, and invoice VAT snapshots.
- Payments: multiple payments per invoice, partial payments, balance calculation, and payment history.
- Receivables: overdue invoices, unpaid totals, upcoming due invoices, and customer exposure dashboard.
- Reminders: manual reminders, automatic due-reminder runner, and reminder history.
- Reports: receivables aging and VAT/tax summary with CSV export.
- Settings: company profile, email delivery status, test email, and email log history.
- User management: admin-only user list, creation, update, activation, role management, and self-protection.
- Production readiness: health/readiness endpoints, structured logs, request IDs, env validation, CI workflow, Docker files, and deployment guide.

## Business Rules

- Customers with existing invoices cannot be deleted. Administrators should deactivate those customers instead, so invoice history stays intact.
- Only draft invoices can be edited. Sent/open invoices can be paid, cancelled, emailed, exported as PDF, or followed up with reminders.
- Paid, partially paid, and overdue invoice statuses are calculated by the backend from due dates and payments.
- VAT is calculated by the backend from the customer's country. Morocco customers use the configured Morocco VAT rate when VAT is enabled; foreign customers use 0%. Admin overrides require a reason and are saved on the invoice.
- Invoices store customer country, country code, VAT rate, VAT amount, and override audit data as a snapshot, so old invoices are not changed by later customer or VAT setting edits.
- Every protected business route is enforced by the backend with a database permission key. The default `ADMIN` role receives all permissions; `EMPLOYEE` receives the operational permissions assigned in the RBAC migration. The legacy enum remains only for JWT compatibility and is not used as the authorization decision.

## RBAC Administration

Administrators can open `Roles & permissions` in the application to create roles, review the permission catalog, assign permissions with checkboxes, and assign roles to users. The backend endpoints are:

- `GET/POST /api/rbac/roles`
- `PUT/DELETE /api/rbac/roles/:id`
- `PUT /api/rbac/roles/:id/permissions`
- `GET/POST /api/rbac/permissions`
- `DELETE /api/rbac/permissions/:id`
- `GET /api/rbac/users`
- `PUT /api/rbac/users/:id/role`

The RBAC schema is designed as a framework-independent authorization layer, so the same `roles`, `permissions`, and `role_permissions` concepts can be mapped to Django models later without changing business rules.

## Requirements

- Windows, macOS, or Linux
- Node.js 20 or newer
- npm
- PostgreSQL 15 or newer

Docker files are included for future deployment, but Docker is not required for local development.

## Local Windows Setup

1. Install dependencies:

```powershell
npm.cmd install
```

2. Start PostgreSQL locally.

On Windows, confirm the service is running:

```powershell
Get-Service | Where-Object { $_.DisplayName -like '*PostgreSQL*' }
```

3. Create the backend environment file:

```powershell
Copy-Item server\.env.local.example server\.env
```

4. Edit `server\.env` and set your local PostgreSQL password. Example:

```env
DATABASE_URL="postgresql://postgres:chaki@localhost:5432/billing_db?schema=public"
CLIENT_URL="http://localhost:5173"
AI_BACKGROUND_REMOVAL_PYTHON="python"
AI_BACKGROUND_REMOVAL_MODEL="ZhengPeng7/BiRefNet"
AI_BACKGROUND_REMOVAL_IMAGE_SIZE=768
```

5. Install the local AI background-removal runtime:

```powershell
python -m pip install -r server\requirements-ai.txt
```

The first signature or stamp processing downloads the configured open-source BiRefNet/RMBG-compatible model into the local Hugging Face cache. After that, removal runs locally without an external API key. `ZhengPeng7/BiRefNet` is used by default because BRIA RMBG-2.0 weights require access approval on Hugging Face; if you have those weights locally or approved access, set `AI_BACKGROUND_REMOVAL_MODEL="briaai/RMBG-2.0"`.

6. Generate Prisma client, apply migrations, and seed the demo workspace:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:seed
```

7. Start the backend:

```powershell
npm.cmd run dev:server
```

8. Start the frontend in another terminal:

```powershell
npm.cmd run dev:client
```

9. Open the app:

```text
http://localhost:5173
```

## Demo Accounts

```text
Admin
admin@billingsystem.com
admin123

Employee
sara@billingsystem.com
employee123

Employee
youssef@billingsystem.com
employee123
```

The seed resets and recreates a realistic demo workspace: 1 admin, 2 employees, company settings, 3 products, 2 customers, 4 invoices, matching payments, reminders, and invoice email logs. Change all seeded passwords and review or replace demo business data before using real production data.

## Email Behavior

In development, if SMTP values are still demo values, the app uses local email fallback and writes generated email files under:

```text
server/uploads/emails
```

For production, configure real SMTP credentials in `server/.env`.

## Useful Scripts

```powershell
npm.cmd run dev:server
npm.cmd run dev:client
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:migrate:prod --workspace=server
npm.cmd run db:seed
npm.cmd run db:validate
npm.cmd test
npm.cmd run lint:client
npm.cmd run build:server
npm.cmd run build:client
npm.cmd run build
npm.cmd run check
```

`npm.cmd run check` is the full release gate: dependency audit, Prisma validation, frontend lint, backend tests, and production builds.

## Health Checks

```text
GET /health
GET /ready
```

`/health` confirms the API process is alive. `/ready` also verifies database connectivity.

## API Overview

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PATCH /api/auth/password`
- `GET /api/customers`
- `POST /api/customers`
- `GET /api/customers/:id`
- `PUT /api/customers/:id`
- `DELETE /api/customers/:id` admin only
- `GET /api/products`
- `POST /api/products` admin only
- `PUT /api/products/:id` admin only
- `GET /api/invoices/dashboard`
- `GET /api/invoices`
- `POST /api/invoices`
- `GET /api/invoices/:id`
- `PUT /api/invoices/:id`
- `GET /api/invoices/:id/pdf`
- `POST /api/invoices/:id/sign` admin only
- `DELETE /api/invoices/:id/sign` admin only
- `POST /api/invoices/:id/email`
- `PATCH /api/invoices/:id/status`
- `POST /api/invoices/:id/payments`
- `GET /api/payments`
- `GET /api/reminders`
- `POST /api/reminders`
- `POST /api/reminders/run-due` admin only
- `GET /api/reports/receivables-aging`
- `GET /api/reports/tax-summary`
- `GET /api/users` admin only
- `POST /api/users` admin only
- `PUT /api/users/:id` admin only
- `GET /api/settings/company`
- `PUT /api/settings/company` admin only
- `POST /api/settings/company/signature` admin only
- `DELETE /api/settings/company/signature` admin only
- `POST /api/settings/company/signature/remove-background` admin only
- `POST /api/settings/company/stamp` admin only
- `DELETE /api/settings/company/stamp` admin only
- `POST /api/settings/company/stamp/remove-background` admin only
- `POST /api/settings/company/remove-background-preview` admin only
- `GET /api/settings/email-status` admin only
- `POST /api/settings/email-test` admin only
- `GET /api/settings/email-logs` admin only

## Production Build

```powershell
npm.cmd run check
npm.cmd run build
```

Frontend output is generated in `client/dist`. Backend output is generated in `server/dist`.

## Release Validation

Run these checks before pushing to GitHub or deploying:

```powershell
npm.cmd run test
npm.cmd run build
npm.cmd run check
```

Manual smoke coverage should include:

- Admin and employee login, rejected invalid login, logout, and current-user session state.
- Dashboard, Clients, Factures, Paiements, Rapports, Relances, Catalogue, Utilisateurs, and Parametres pages.
- Customer create, search, update, deactivate, delete without invoices, and blocked delete with invoices.
- Product list, create, update, active/inactive filtering, and employee write-access denial.
- Draft invoice create/update, send status, PDF download, payment recording, and balance/status refresh.
- Dynamic VAT with Morocco customer, foreign customer, changed Morocco VAT rate, invoice snapshot preservation, and admin-only override reason.
- Invoice search by invoice number, customer name, customer email, company, phone, and tax number.
- Company signature/stamp upload, preview, optional local AI background removal, manual editor confirmation, save, delete, and persistence after refresh.
- Invoice signing, signed PDF download/print, signature cancellation, and blocked duplicate signing/cancellation.
- Reminder create/list and admin automatic reminder generation.
- Receivables aging and tax summary reports.
- Company settings read/update, email delivery status, and email log list.
- Admin user create/list/update and employee denial for admin-only user routes.

For production, also verify real SMTP delivery, HTTPS/TLS, domain-specific `CLIENT_URL`, database backups, secret rotation, and monitoring for `/health` and `/ready`.

## GitHub Preparation

Before pushing:

```powershell
git status
npm.cmd run check
```

Do not commit:

- `server/.env`
- generated logs
- `server/uploads/*`
- `node_modules`
- build output directories

The repository includes `.github/workflows/ci.yml`, which runs the release checks against PostgreSQL on pull requests and pushes to `main` or `master`.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for production environment variables, Node deployment, Docker deployment, and smoke checks.
