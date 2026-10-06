# Развёртывание JANTOK

## Границы документа

Репозиторий готовит Docker images, Compose staging overlay, Nginx TLS/WebSocket template, migrations, health checks, backup/restore и release checks. Он не покупает домен/VPS, не создаёт платные договоры, не выпускает сертификаты и не публикует приложения без отдельной авторизации.

## Окружения

| Окружение | Данные и secrets | Providers | Seed |
| --- | --- | --- | --- |
| LOCAL | `.env`, local volumes, synthetic users | только явно маркированные local simulators | разрешён явной командой |
| STAGING | отдельные DB/Redis/bucket/secrets/domain | provider sandbox после adapter либо `unconfigured` | demo seed запрещён обычным runtime; fixtures — только в изолированном test окружении |
| PRODUCTION | отдельные production ресурсы и secret manager | только production adapters либо fail-closed `unconfigured` | всегда запрещён |

Нельзя использовать один bucket/database/credential между окружениями.

## Артефакты

- backend image: multi-stage Node.js 24 runtime без devDependencies;
- worker image: тот же domain build, отдельный process;
- admin image: Next.js standalone production build;
- mobile: Android AAB/APK и iOS archive создаются отдельным release pipeline после signing setup;
- DB: `jantok-backend/prisma/migrations/` применяются forward-only;
- edge: `compose.staging.yaml` + `infra/nginx/jantok.conf`.

## Подготовка staging

Требуются данные из `docs/CLIENT_DATA_REQUEST.md`. Заполненный environment file хранится вне репозитория с минимальными правами.

Проверка конфигурации без запуска:

```bash
docker compose --env-file /secure/jantok-staging.env \
  -f compose.yaml -f compose.staging.yaml config --quiet
```

Порядок первого запуска:

1. Создать отдельные PostgreSQL, Redis и private S3 bucket.
2. Настроить DNS домена на edge/VPS.
3. Установить TLS certificate/key в ожидаемый защищённый mount Nginx.
4. Собрать immutable images из конкретного commit.
5. Выполнить backup пустого/предыдущего окружения.
6. Запустить migration job `npm run db:migrate:deploy` один раз.
7. Поднять backend/worker/admin/edge.
8. Дождаться `/api/v1/health/ready` и проверить PostgreSQL/Redis/storage = `up`.
9. Проверить OpenAPI, staff login, WebSocket support и provider sandbox capabilities.
10. Выполнить smoke/E2E без реальных денег, массовых SMS и courier dispatch.

Команда Compose после подготовки secrets/TLS:

```bash
docker compose --env-file /secure/jantok-staging.env \
  -f compose.yaml -f compose.staging.yaml up --detach --wait
```

## Production release gate

Production rollout разрешается только когда:

- `APP_ENV=production`, `DEMO_SEED_ENABLED=false`;
- local provider modes и известные local secrets отсутствуют;
- два разных production Super Admin заданы в E.164;
- production DB/Redis/bucket backup создан и restore проверен отдельно;
- реальные adapters/credentials/capabilities проверены в staging;
- approved pricing/nutrition/loyalty/delivery settings активированы;
- домен, TLS, CORS и public API URL согласованы;
- Android/iOS signing и store metadata принадлежат владельцу;
- CI по commit зелёный на hosted runner;
- миграции применены к копии production-подобной DB;
- план rollback/incident contacts утверждён.

Backend намеренно не стартует с опасной demo-конфигурацией. `unconfigured` может позволить запустить read-only части staging, но операции соответствующего provider будут возвращать явную недоступность, а не fake success.

## Миграции

```bash
cd jantok-backend
npm ci
npm run prisma:validate
npm run db:migrate:deploy
npx prisma migrate status
```

Не использовать `prisma db push`, destructive reset или demo seed в staging/production. Migration выполняется до переключения трафика и только одним deployment job.

## Rollback

Prisma migrations forward-only.

- Если schema change обратно совместим: вернуть предыдущий application image, schema не откатывать.
- Если migration несовместима или повредила данные: остановить writers, восстановить проверенный PostgreSQL dump и object-storage snapshot в **отдельные** DB/bucket, валидировать, затем осознанно переключить конфигурацию.
- Не восстанавливать production поверх работающей DB без maintenance window и утверждённого incident action.

Local restore command защищён environment check и confirmation flag. Подробная mechanics — `docs/OPERATIONS.md`.

## Backup

`make backup` создаёт PostgreSQL custom dump, архив MinIO и manifest. Для staging/production внешний scheduler должен:

- использовать отдельный защищённый backup storage;
- шифровать данные at rest/in transit;
- применять утверждённый retention;
- проверять restore на отдельном окружении;
- мониторить свежесть и failures.

Значение `BACKUP_RETENTION_DAYS` — policy input, но удаление не скрыто внутри обычного start/backup.

## Edge, TLS и WebSocket

Nginx template:

- завершает TLS;
- проксирует `/api/` и Socket.IO Upgrade;
- отдаёт Admin;
- применяет coarse rate limits;
- не публикует PostgreSQL/Redis/MinIO console наружу.

`JANTOK_DOMAIN`, certificate и private key предоставляет владелец инфраструктуры. CORS должен содержать только точные approved HTTPS origins.

## Наблюдаемость

- `/api/v1/health/live` — process liveness;
- `/api/v1/health/ready` — PostgreSQL, Redis, storage;
- structured JSON logs с request ID, path/status/duration;
- `worker.ready`, `worker.job_failed`, graceful shutdown events;
- persisted outbox/jobs/provider events доступны для reconciliation;
- alerting должен различать provider outage, retry exhaustion, DB/storage unready и internal 500.

До live-запуска владелец выбирает log/metric/alert destination. Request bodies, OTP, tokens, PAN/CVV, photos и анкеты туда не отправляются.

## CI/CD

`.github/workflows/ci.yml` имеет независимые jobs:

- backend: clean PostgreSQL migration, audit, lint/typecheck/unit/e2e/build;
- admin: audit/lint/typecheck/build;
- mobile: format/analyze/test/debug APK/goldens;
- infrastructure: local и staging Compose config;
- acceptance: полный disposable Stage 10 и evidence artifacts.

Deployment job намеренно отсутствует. Первый hosted green run требует Git remote/push и должен быть подтверждён до production. Локальный эквивалент: `./scripts/verify-local.sh`, `make verify-stage10`, `./scripts/verify-stage11.sh`.

## Mobile release

Android production publication требует upload key/Play Console и release AAB. iOS требует полный Xcode, Apple Developer team, signing profiles/certificates, App Store Connect и provider entitlements. Точный текущий статус — `docs/IOS_READINESS.md` и `docs/STAGE8_MOBILE_RELEASE.md`.
