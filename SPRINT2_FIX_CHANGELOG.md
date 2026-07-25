# Sprint 2 corrective release

- Fixed Prisma P3006 migration ordering without resetting data.
- Separated recurring permission grants into a migration that runs after Dynamic RBAC.
- Added PROCESSING execution state and idempotent execution reservation.
- Prevented two scheduler workers from creating two invoices for the same plan/date.
- Kept all Sprint 1 source files; recurring billing only adds files.
- Added production-safe migration and status scripts.
