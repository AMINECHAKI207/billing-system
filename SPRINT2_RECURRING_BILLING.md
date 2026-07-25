# Sprint 2 — Recurring Billing

This sprint adds production-oriented recurring invoice plans.

## Included
- Weekly, monthly, quarterly and yearly plans.
- Start/end dates, due-day configuration and pause/resume/cancel lifecycle.
- Automatic hourly scheduler with idempotent execution records.
- Manual **Run now** action.
- Automatic invoice creation linked back to the recurring plan.
- ALL / OWN / SELECTED RBAC scopes inherited through customer access.
- Execution history and failure logging.
- Payments-page UI for creating and managing plans.

## API
- `GET/POST /api/recurring-plans`
- `GET/PUT /api/recurring-plans/:id`
- `PATCH /api/recurring-plans/:id/status`
- `POST /api/recurring-plans/:id/run`

## Setup
```powershell
npm install
npm run db:generate
npm run db:migrate
npm run build
npm run dev
```

The migration grants all recurring permissions to ADMIN and OWN-scoped permissions to EMPLOYEE.
