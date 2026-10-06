# JANTOK Food

Stage 0–11 implementation: authentication, household nutrition safety, subscriptions, idempotent payments, loyalty, delivery, kitchen/inventory, Admin/RBAC, Flutter, local operations, isolated acceptance tests, load checks, CI and launch documentation for JANTOK.

For a short Russian launch guide, start with [`QUICKSTART.md`](QUICKSTART.md). The current evidence-based status is in [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md); data still required from the owner is consolidated in [`docs/CLIENT_DATA_REQUEST.md`](docs/CLIENT_DATA_REQUEST.md).

## Workspace

- `jantok-mobile/` — Flutter 3.47 / Riverpod / go_router; open this directory in Android Studio.
- `jantok-backend/` — NestJS 12 / Prisma 7 / PostgreSQL / Redis / BullMQ.
- `jantok-admin/` — Next.js 16 / React / TypeScript.
- `compose.yaml` — PostgreSQL, Redis, MinIO, API, worker and admin.
- `infra/nginx/` — staging TLS/WebSocket reverse proxy template.

## Quickstart: full local stack

Requirements: Docker Desktop with Compose v2, `curl`, `jq` and OpenSSL. The setup command creates `.env` only when it is absent and generates independent local secrets; it never replaces an existing file.

```bash
make setup-demo
make start
```

`make setup` omits demo data. `make setup-demo` explicitly opts into the idempotent catalog/persona seed, including two local Super Admin accounts, restricted staff roles, incomplete/single/family customer fixtures and an allergy-safe/unsafe menu pair. Ordinary `make start` applies no destructive reset and preserves all volumes. `make verify` creates the mutable payment/delivery/kitchen/support scenario through real APIs rather than inserting successful financial states directly.

Available endpoints:

- Admin: <http://localhost:3000>
- API liveness: <http://localhost:8080/api/v1/health/live>
- API readiness: <http://localhost:8080/api/v1/health/ready>
- OpenAPI UI: <http://localhost:8080/api/docs>
- MinIO API/console: <http://localhost:9000> / <http://localhost:9001>

Local OTP does not send SMS and is restricted to the synthetic phones listed in `.env.example`. Request a code through the mobile/admin UI or API; inspect it only through the token-protected local inbox:

```bash
curl -X POST http://localhost:8080/api/v1/auth/otp/request \
  -H 'content-type: application/json' \
  -d '{"phone":"+77000000001","deviceId":"local-cli"}'
curl http://localhost:8080/api/v1/auth/otp/dev-inbox/%2B77000000001 \
  -H 'x-dev-inbox-token: local-dev-inbox-token-change-before-sharing'
```

Local SMS, payment and receipt simulators cannot be selected in production. Real acquiring/fiscalization contracts and credentials must be supplied before cash production deployment; see `docs/ENV_REQUIRED.md`.

Stop while preserving PostgreSQL/Redis/storage volumes:

```bash
make stop
```

`docker compose down --volumes` intentionally deletes local data and is not part of normal startup/update.

Operational commands:

```bash
make migrate
make seed
make verify
make backup
make restore BACKUP=/absolute/path/to/backups/20260925T120000Z
```

Backup/restore, staging overlay, provider modes, migration rollback and incident checks are documented in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Local checks equivalent to CI

```bash
./scripts/verify-local.sh
```

The isolated clean-database/Compose verification uses project name `jantok_clean_verify` and deletes only that temporary project's volumes on exit. Stop the normal stack first because both expose the same local ports:

```bash
./scripts/verify-compose.sh
```

With the normal local stack running, verify the complete Stage 1 acceptance path (registration, two members, restart persistence, two devices and member-specific allergen blocking):

```bash
./scripts/verify-stage1-e2e.sh
```

Verify the Stage 2 path (itemized quote/payment freeze, menu snapshots, 30-day allocation ledger, skip/pause, prorated permanent member, guest purchase and auto-renew):

```bash
./scripts/verify-stage2-e2e.sh
```

Stage 2 client/API entry points:

- Mobile: after login, use the restaurant icon on “Моя семья” for the seven-day menu, quote and current subscription calendar.
- Admin: after staff OTP login, the dashboard shows immutable pricing/cut-off versions.
- API: `/api/v1/menu`, `/api/v1/subscriptions/*`, and permission-protected `/api/v1/staff/subscriptions/*` operations are visible in OpenAPI.

Stage 3 API entry points are `/api/v1/payments/checkout`, `/api/v1/payments/history`, `/api/v1/payments/methods`, `/api/v1/payments/refunds`, the authenticated provider webhook, and permission-protected `/api/v1/staff/payments/*`. Local receipts are deliberately labelled test/non-fiscal.

Verify Stage 4 referral, duplicate-webhook, promo/bonus ordering, 100% bonus checkout and recurring add-on transfer:

```bash
./scripts/verify-stage4-e2e.sh
```

Stage 4 entry points are `/api/v1/loyalty/club`, `/api/v1/loyalty/addons`, `/api/v1/payments/addons/recurring`, referral code on OTP registration, promo code on subscription quote and permission-protected `/api/v1/staff/stage4-config/*`. The mobile CLUB screen is opened by the award icon; staff can inspect and create draft loyalty/promo settings in Admin.

Verify Stage 5 address geometry, dispatch scheduling and delivery idempotency:

```bash
./scripts/verify-stage5-e2e.sh
```

Verify Stage 6 production variants, inventory idempotency, waste accounting, packing guard and PDF generation:

```bash
./scripts/verify-stage6-e2e.sh
```

Run the Stage 9 real-API path—OTP through delivery, review, photo support, refund and full-bonus add-on payment—against a freshly seeded local stack:

```bash
./scripts/verify-stage9-e2e.sh
```

Stage 6 staff entry points are under `/api/v1/staff/kitchen/*`; implementation rules and lifecycle details are in `docs/STAGE6_KITCHEN_INVENTORY.md`.

The latest Stage 9 commands, per-step results, backup/restore drill and known local-tooling warnings are recorded in [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md).

Run all Stage 10 invariants against disposable PostgreSQL/Redis/MinIO volumes, then execute the Flutter visual/resilience suite, build the Android ARM64 debug APK and run the first-client load profile:

```bash
make verify-stage10
```

The runner accepts only a disposable `jantok_stage10_*` Compose project, removes only that project's volumes on exit, and writes machine-readable evidence, logs, load metrics and the APK under `output/stage10/`. The command-to-result matrix for T01–T42 and honest environment limitations are in [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md).

## Individual development

Backend requires PostgreSQL, Redis and MinIO environment values. The simplest path is to start dependencies from Compose and run the API locally with host URLs:

```bash
docker compose up --detach postgres redis storage storage-init
cd jantok-backend
export DATABASE_URL='postgresql://jantok:jantok_local_only@localhost:55432/jantok?schema=public'
export REDIS_URL='redis://localhost:56380/0'
export S3_ENDPOINT='http://localhost:9000'
export S3_REGION='us-east-1'
export S3_BUCKET='jantok-local'
export S3_ACCESS_KEY_ID='jantok_local'
export S3_SECRET_ACCESS_KEY='jantok_local_storage_secret'
npm ci
npm run db:migrate:deploy
npm run start:dev
```

Admin:

```bash
cd jantok-admin
npm ci
npm run dev
```

Mobile:

```bash
cd jantok-mobile
flutter pub get
flutter analyze
flutter test
flutter run
```

For an Android emulator, pass its host bridge explicitly: `flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8080/api/v1`.

## Secrets and deployment

Do not commit `.env`. Technical environment fields are listed in [`docs/ENV_REQUIRED.md`](docs/ENV_REQUIRED.md); the plain-Russian owner checklist is [`docs/CLIENT_DATA_REQUEST.md`](docs/CLIENT_DATA_REQUEST.md). The Nginx template expects `JANTOK_DOMAIN` substitution plus certificate files mounted at `/etc/nginx/tls`; no domain or certificate is invented by this repository.

## Documentation map

- [Architecture and ADRs](docs/ARCHITECTURE.md)
- [Database and logical ERD](docs/DATABASE.md)
- [REST OpenAPI, realtime, jobs and state transitions](docs/API.md)
- [External integrations and provider modes](docs/INTEGRATIONS.md)
- [Requirements traceability](docs/REQUIREMENTS_TRACEABILITY.md)
- [Assumptions and external blockers](docs/ASSUMPTIONS.md)
- [Deployment and rollback](docs/DEPLOYMENT.md)
- [iOS readiness](docs/IOS_READINESS.md)
- [Stage 10/11 test report](docs/TEST_REPORT.md)
- [Owner data request](docs/CLIENT_DATA_REQUEST.md)
