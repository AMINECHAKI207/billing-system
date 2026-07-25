# Deployment Guide

## 1. Infrastructure

Prepare:

- PostgreSQL 15 or newer with a dedicated database and user.
- Node.js 20 or newer for non-Docker backend hosting.
- Static hosting or Nginx/Apache for `client/dist`.
- HTTPS for production cookies and authenticated API traffic.
- Persistent storage for `UPLOADS_DIR` and logs.
- Scheduled database backups.
- Centralized log collection if the app runs on a server or platform.

Set `TRUST_PROXY=true` when the API runs behind Nginx, a load balancer, or a hosting platform proxy.

## 2. Production Environment

Create `server/.env` on the host with real production values:

```env
NODE_ENV=production
PORT=5000
CLIENT_URL=https://your-frontend-domain.example
TRUST_PROXY=true
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public
JWT_ACCESS_SECRET=replace-with-long-random-secret
JWT_REFRESH_SECRET=replace-with-another-long-random-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
COOKIE_SECRET=replace-with-cookie-secret
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM_NAME=Billing System
SMTP_FROM_EMAIL=billing@example.com
UPLOADS_DIR=uploads
AI_BACKGROUND_REMOVAL_PYTHON=python
AI_BACKGROUND_REMOVAL_MODEL=ZhengPeng7/BiRefNet
AI_BACKGROUND_REMOVAL_IMAGE_SIZE=768
AI_BACKGROUND_REMOVAL_TIMEOUT_MS=180000
HF_HOME=/var/lib/billing-system/model-cache
DEFAULT_CURRENCY=MAD
```

Production startup fails if known development secrets are used. The AI background removal model runs locally; no external API key is required. For Docker deployments, the backend image provides `/opt/ai-venv/bin/python`, Compose uses it by default, and the model cache is persisted in the `api_model_cache` volume. For non-Docker deployments, install `server/requirements-ai.txt` in the Python environment referenced by `AI_BACKGROUND_REMOVAL_PYTHON` and point `HF_HOME` to persistent storage.

## 3. Node Deployment

Install dependencies:

```powershell
npm.cmd ci
```

Generate Prisma client and apply migrations:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate:prod --workspace=server
```

Build:

```powershell
npm.cmd run build
```

Start the backend:

```powershell
npm.cmd run start --workspace=server
```

Serve the frontend from:

```text
client/dist
```

Reverse proxy routing:

- `/api/*` to the backend
- `/health` to the backend
- `/ready` to the backend
- all other frontend paths to `client/dist/index.html`

## 4. Docker Deployment

Docker files are included for future deployment:

- `server/Dockerfile`
- `client/Dockerfile`
- `client/nginx.conf`
- `docker-compose.prod.yml`

Set required variables before running production Compose:

```powershell
$env:POSTGRES_PASSWORD="replace-with-strong-password"
$env:CLIENT_URL="https://your-frontend-domain.example"
$env:JWT_ACCESS_SECRET="replace-with-long-random-secret"
$env:JWT_REFRESH_SECRET="replace-with-another-long-random-secret"
$env:COOKIE_SECRET="replace-with-cookie-secret"
$env:SMTP_HOST="smtp.example.com"
$env:SMTP_USER="your-smtp-user"
$env:SMTP_PASS="your-smtp-password"
$env:SMTP_FROM_EMAIL="billing@example.com"
$env:AI_BACKGROUND_REMOVAL_MODEL="ZhengPeng7/BiRefNet"
$env:AI_BACKGROUND_REMOVAL_IMAGE_SIZE="768"
$env:AI_BACKGROUND_REMOVAL_TIMEOUT_MS="180000"
$env:HF_HOME="/app/model-cache"
$env:WEB_PORT="8080"
```

Start:

```powershell
docker compose -f docker-compose.prod.yml up --build -d
```

The Compose file includes a one-shot `migrate` service. The API waits for PostgreSQL to become healthy and for Prisma migrations to finish before it starts.

Check status:

```powershell
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs api
```

## 5. Smoke Checks

Run these after every deployment:

- `GET /health` returns HTTP 200.
- `GET /ready` returns HTTP 200.
- Admin login succeeds.
- Employee login succeeds.
- Employee receives HTTP 403 for admin-only endpoints.
- Employee receives HTTP 403 for `DELETE /api/customers/:id`.
- Admin can delete a customer without invoices.
- Invoice creation calculates totals and balance correctly.
- Payment recording updates invoice balance/status.
- Invoice PDF download works.
- Admin can upload a signature and stamp.
- Local AI background removal works for signature/stamp images.
- Admin can sign an invoice, download the signed PDF, cancel the signature, and verify duplicate cancellation returns HTTP 409.
- Invoice email sending works with SMTP or local fallback in development.
- Receivables aging report loads.
- VAT/tax summary report loads.
- Frontend production bundle loads without console runtime errors.

## 6. Release Gate

Before shipping:

```powershell
npm.cmd run db:validate
npm.cmd test
npm.cmd run lint:client
npm.cmd run build
npm.cmd run check
```

## 7. Production Checklist

- Replace the seeded default Admin password.
- Use long random JWT and cookie secrets.
- Configure production SMTP credentials.
- Enable HTTPS.
- Configure persistent upload storage.
- Configure persistent model/cache storage with `HF_HOME` so local AI model downloads survive restarts.
- Apply database migrations with `prisma migrate deploy`.
- Schedule PostgreSQL backups.
- Collect application logs.
- Monitor `/health` and `/ready`.
- Keep `.env`, logs, uploads, `node_modules`, and build output out of Git.
