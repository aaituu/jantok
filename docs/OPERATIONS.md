# Operations and environment separation

Это операционный runbook для scripts/backup/restore/incidents. Полный release gate и порядок staging/production deployment описаны в `docs/DEPLOYMENT.md`.

## Local lifecycle

The supported entry points are `make setup`, `make setup-demo`, `make start`, `make stop`, `make migrate`, `make seed`, `make verify`, `make backup`, and `make restore BACKUP=...`.

- Setup checks Docker Compose, curl, jq and OpenSSL. It creates `.env` only when absent, gives it mode `0600`, and replaces template secrets with independent random values.
- Demo seed requires the explicit `--demo`/`make seed` action and is rejected outside `APP_ENV=local|test`.
- Start never drops schemas or volumes. Stop uses `docker compose down` without `--volumes`.
- The API, worker and admin run in one Compose network. PostgreSQL, Redis and MinIO use named persistent volumes.
- MinIO initialization creates the configured private bucket idempotently. Customer photos are stored as private objects and are not converted to public URLs.

## Provider modes

Every provider mode is explicit. The implemented local adapters are selected only by `local`; `unconfigured` fails closed. A vendor sandbox or production adapter must be added under a distinct documented mode only after official credentials and contracts exist. There is no fallback from an unavailable real adapter to a simulator.

Production rejects local OTP, payment, fiscalization, delivery and push configuration and rejects known local secrets. Local simulator inbox/callback routes return 404 outside local/test or when the corresponding local mode is not selected.

## Backups and restore

`make backup` writes a timestamped directory containing:

- PostgreSQL custom-format dump;
- compressed MinIO data snapshot;
- versioned manifest.

The default directory is ignored by Git. Configure retention in the external scheduler using `BACKUP_RETENTION_DAYS`; automatic deletion is intentionally not hidden inside ordinary backup/start commands.

Restore is destructive and therefore requires both an exact backup directory and `--confirm-local-restore`. It refuses non-local/test environments, stops application writers, recreates only the configured database's `public` schema, restores the dump, and restores the exact MinIO volume contents. Verify a backup in a separate Compose project/database before relying on it:

```bash
COMPOSE_PROJECT_NAME=jantok_restore_test \
POSTGRES_HOST_PORT=65432 REDIS_HOST_PORT=66380 BACKEND_HOST_PORT=18080 \
  docker compose up --detach --wait postgres redis storage storage-init
COMPOSE_PROJECT_NAME=jantok_restore_test ./scripts/local.sh restore /absolute/backup --confirm-local-restore
```

Never point a restore verification at staging or production.

## Staging and production

`.env.staging.example` and `.env.production.example` contain placeholders only. Supply real values through a secret store, never by committing filled files. The staging overlay removes direct database/cache/application ports and adds the TLS/WebSocket Nginx edge:

```bash
docker compose --env-file /secure/jantok-staging.env \
  -f compose.yaml -f compose.staging.yaml config
docker compose --env-file /secure/jantok-staging.env \
  -f compose.yaml -f compose.staging.yaml up --detach --wait
```

Provider modes remain `unconfigured` until adapters exist, so payment/delivery/SMS actions fail closed rather than simulating success.

## Migrations and rollback

1. Take and verify a backup.
2. Build the exact application image and run `npm run db:migrate:deploy` once as a deployment job.
3. Check `/api/v1/health/ready` before shifting traffic.
4. Prisma migrations are forward-only. For an application rollback, deploy the previous compatible image without reverting an additive schema. For an incompatible/data migration, stop writers and restore the verified pre-migration PostgreSQL and object snapshot into a separate database/bucket, validate it, then switch configuration deliberately.
5. Never run demo seed or destructive schema commands in production.

## Security and incident visibility

- API responses and structured logs share a sanitized correlation ID. Completion logs contain method, path, status and duration, never request bodies, OTP values, tokens, PAN/CVV or uploaded content.
- Helmet, strict DTO whitelisting, explicit 1 MiB JSON/form limits, 5 MiB image limits/signature checks, exact CORS origins, bearer authentication and ownership/RBAC checks protect API boundaries. Admin uses bearer tokens rather than cookie authentication, so cookie-CSRF is not an active authentication path.
- OTP rate limits are Redis-backed by phone, IP and device. Nginx adds coarse per-IP OTP/API limits at the public edge.
- Readiness checks PostgreSQL, Redis and object storage. Worker failures are emitted as structured `worker.job_failed` events; provider events and retries remain persisted for reconciliation.
- Graceful shutdown hooks close Nest, BullMQ and Redis connections. External-service failures remain distinguishable from internal 500 responses.

No command in this runbook buys infrastructure, sends bulk messages, charges real money, dispatches a real courier, or publishes an application.
