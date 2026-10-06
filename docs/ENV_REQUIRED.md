# Обязательные переменные окружения

Секреты и персональные данные не хранятся в Git. `.env.example` содержит только безопасные local/dev значения. Staging/production значения должны поступать из secret store CI/VPS.

Это технический справочник. Единый список того, что и когда нужно прислать владельцу проекта, находится в `docs/CLIENT_DATA_REQUEST.md`. Сами секреты нельзя присылать в обычный чат.

| Переменная | Зачем и где используется | Что предоставить | Формат | Безопасное local/dev значение |
| --- | --- | --- | --- | --- |
| `APP_ENV` | Режим backend и защита production | Окружение deployment | `local`, `test`, `staging`, `production` | `local` |
| `SUPER_ADMIN_PHONE_1` | Первый владелец/Super Admin; backend bootstrap | Реальный номер первого владельца | E.164 `+7XXXXXXXXXX` | Нет; пусто допустимо только вне production |
| `SUPER_ADMIN_PHONE_2` | Резервный Super Admin; backend bootstrap | Второй отличный номер владельца | E.164 `+7XXXXXXXXXX` | Нет; пусто допустимо только вне production |
| `POSTGRES_DB` | Имя PostgreSQL DB; Compose/backend | Имя отдельной DB окружения | PostgreSQL identifier | `jantok` |
| `POSTGRES_USER` | Пользователь PostgreSQL; Compose/backend | Отдельный пользователь окружения | PostgreSQL identifier | `jantok` |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL; Compose/backend | Уникальный случайный secret | Строка высокой энтропии | `jantok_local_only` |
| `POSTGRES_HOST_PORT` | Host-port local PostgreSQL; Compose | Только если стандартный local port нужно изменить | TCP port | `55432` |
| `DATABASE_URL` | Prisma connection; backend/CLI | URL конкретной DB | `postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public` | host: `postgresql://jantok:jantok_local_only@localhost:55432/jantok?schema=public`; Compose: port `5432` |
| `REDIS_URL` | BullMQ/cache; backend/worker | URL отдельного Redis, с паролем вне local | `redis://[:PASSWORD@]HOST:PORT/DB` | host: `redis://localhost:56380/0`; Compose: port `6379` |
| `REDIS_HOST_PORT` | Host-port local Redis; Compose | Только если local port нужно изменить | TCP port | `56380` |
| `MINIO_ROOT_USER` | Администратор local/staging MinIO; Compose | Непубличное имя root пользователя | Строка от 3 символов | `jantok_local` |
| `MINIO_ROOT_PASSWORD` | Root secret MinIO; Compose/bootstrap | Уникальный случайный secret | Минимум 8 символов | `jantok_local_storage_secret` |
| `S3_ENDPOINT` | S3-compatible endpoint; backend health/files | HTTPS endpoint storage | Абсолютный URL | `http://localhost:9000` |
| `S3_REGION` | Регион S3; backend/files | Регион bucket провайдера | Region identifier | `us-east-1` |
| `S3_BUCKET` | Bucket файлов; backend/bootstrap | Уникальное имя bucket окружения | DNS-compatible name | `jantok-local` |
| `S3_ACCESS_KEY_ID` | Технический доступ к bucket; backend | Access key с минимальными правами | Provider string | `jantok_local` |
| `S3_SECRET_ACCESS_KEY` | Secret технического доступа; backend | Secret key для access key | Строка высокой энтропии | `jantok_local_storage_secret` |
| `JWT_ACCESS_SECRET` | Подпись access tokens; backend auth | Независимый случайный secret ≥32 bytes | Base64/hex/high-entropy string | `local-access-secret-change-before-deploy-32-bytes` |
| `JWT_REFRESH_SECRET` | HMAC refresh tokens; backend auth | Другой случайный secret ≥32 bytes | Base64/hex/high-entropy string | `local-refresh-secret-change-before-deploy-32-bytes` |
| `SESSION_SECRET` | HMAC push/device tokens | Третий случайный secret ≥32 bytes | Base64/hex/high-entropy string | `local-session-secret-change-before-deploy-32-bytes` |
| `JWT_ACCESS_TTL_SECONDS` | Срок access token; backend auth | Утверждённый security policy при изменении | Positive integer seconds | `900` |
| `JWT_REFRESH_TTL_SECONDS` | Срок refresh session; backend auth | Утверждённый security policy при изменении | Positive integer seconds | `2592000` |
| `OTP_PROVIDER_MODE` | Выбор SMS adapter; backend auth | Для staging/production — выбранный реальный provider после договора | Сейчас `local`; production отклоняет `local` | `local` |
| `OTP_HASH_SECRET` | HMAC OTP и refresh/device token hashes | Отдельный случайный secret ≥32 bytes | Base64/hex/high-entropy string | `local-otp-hash-secret-change-before-deploy-32-bytes` |
| `OTP_DEV_INBOX_TOKEN` | Доступ к local dev OTP inbox | Не используется в production; для shared dev — случайный secret | High-entropy string | `local-dev-inbox-token-change-before-sharing` |
| `OTP_LOCAL_ALLOWED_PHONES` | Номера, которым разрешён local sink | Владелец может прислать отдельные тестовые номера; реальные личные номера не нужны | CSV E.164 | Синтетические валидные KZ `+77000000001`…`+77000000004`, SMS не отправляется |
| `OTP_CODE_LENGTH` | Длина OTP | Security policy при изменении | Integer 6–8 | `6` |
| `OTP_TTL_SECONDS` | Expiration OTP | Security policy при изменении | Positive integer seconds | `300` |
| `OTP_RESEND_SECONDS` | Минимальный интервал resend | Security policy при изменении | Positive integer seconds | `60` |
| `OTP_MAX_ATTEMPTS` | Попытки проверки challenge | Security policy при изменении | Positive integer | `5` |
| `OTP_RATE_LIMIT_WINDOW_SECONDS` | Окно rate limit | Security policy при изменении | Positive integer seconds | `3600` |
| `OTP_RATE_LIMIT_PER_PHONE` | Лимит request/resend на телефон | Security policy при изменении | Positive integer | `5` |
| `OTP_RATE_LIMIT_PER_IP` | Лимит request/resend на IP | Security policy при изменении | Positive integer | `20` |
| `OTP_RATE_LIMIT_PER_DEVICE` | Лимит request/resend на device ID | Security policy при изменении | Positive integer | `10` |
| `PII_ENCRYPTION_KEY` | AES-256-GCM для push token ciphertext и будущих чувствительных integration values | Уникальный случайный ключ окружения | 64 hex chars (32 bytes) | Предсказуемый local-only hex key из `.env.example` |
| `LOCAL_DEMO_ADMIN_PHONES` | Два local Super Admin для проверки RBAC | Только синтетические local номера | CSV из двух E.164 | `+77000000003,+77000000004` |
| `DEMO_SEED_ENABLED` | Явное разрешение demo seed | Только `true` для отдельной local/test seed-команды; всегда `false` в обычном runtime | Boolean | `false` |
| `LOCAL_BACKUP_DIR` | Каталог локальных PostgreSQL/MinIO backup | Отдельный защищённый путь вне web-root | Path | `./backups` |
| `BACKUP_RETENTION_DAYS` | Политика retention для внешнего scheduler/backup job | Утверждённое число дней; удаление выполняется отдельной осознанной задачей | Positive integer | `14` |
| `CORS_ORIGINS` | Допустимые browser origins; backend | Точные HTTPS admin origins | URL через запятую | `http://localhost:3000` |
| `NEXT_PUBLIC_API_BASE_URL` | URL API в admin client | Публичный HTTPS API URL | URL без завершающего `/` | `http://localhost:8080/api/v1` |
| `BACKEND_HOST_PORT` | Host-port API в local Compose | Только если `8080` занят другим проектом | TCP port | `8080` |
| `ADMIN_HOST_PORT` | Host-port Admin в local Compose | Только если `3000` занят другим проектом | TCP port | `3000` |
| `MINIO_API_HOST_PORT` | Host-port S3 API в local Compose | Только если `9000` занят другим проектом | TCP port | `9000` |
| `MINIO_CONSOLE_HOST_PORT` | Host-port MinIO console в local Compose | Только если `9001` занят другим проектом | TCP port | `9001` |
| `JANTOK_DOMAIN` | `server_name` staging Nginx через `envsubst` | Реальный домен после регистрации | Hostname без схемы | Нет; local TLS/Nginx не запускается |
| `PAYMENT_PROVIDER_MODE` | Выбор acquiring adapter | До выбора поставщика production обязан оставаться `unconfigured`; после выбора добавляется именованный adapter | Сейчас `local` или `unconfigured` | `local` |
| `PAYMENT_SIMULATOR_WEBHOOK_SECRET` | HMAC-SHA256 подпись webhook локального симулятора | Только local/test secret ≥32 chars; не является ключом банка | High-entropy string | `local-payment-webhook-secret-change-before-sharing` |
| `FISCALIZATION_PROVIDER_MODE` | Выбор fiscalization adapter | До выбора ОФД/ККМ production обязан оставаться `unconfigured`; после выбора добавляется именованный adapter | Сейчас `local` или `unconfigured` | `local` |
| `PAYMENT_MAINTENANCE_INTERVAL_SECONDS` | Частота persisted outbox/reconciliation/renewal worker | Operations policy; не secret | Positive seconds | `60` |
| `PAYMENT_PROVIDER_ACCOUNT/KEY/WEBHOOK_SECRET` | Будущий acquiring account, API credential и webhook secret | **Не предоставлены; точные имена и формат появятся только из официальной документации выбранного провайдера** | Provider-defined secret values | Нет — local simulator |
| `FISCALIZATION_PROVIDER_ACCOUNT/KEY` | Будущий аккаунт и ключ фискализации | **Не предоставлены; точные имена и формат появятся только после решения бизнеса** | Provider-defined secret values | Нет — non-fiscal receipt simulator |
| `DELIVERY_PROVIDER_MODE` | Выбор адаптера сторонней доставки | До договора JANTOK production обязан оставаться `unconfigured`; `local` разрешён только local/test | Сейчас `local` или `unconfigured` | `local` |
| `DELIVERY_SIMULATOR_WEBHOOK_SECRET` | Аутентификация callback локального симулятора | Только local/test secret ≥32 chars; не является ключом Яндекса | High-entropy string | `local-delivery-webhook-secret-change-before-sharing` |
| `DELIVERY_MAINTENANCE_INTERVAL_SECONDS` | Частота generator/finalization/dispatch/reconciliation worker | Operations policy; не secret | Integer 10–3600 seconds | `60` |
| `DELIVERY_PICKUP_ADDRESS/LATITUDE/LONGITUDE` | Адрес кухни и координаты точки A; координаты передаются провайдеру как `[longitude, latitude]` | Утверждённая production-точка кухни | Address + WGS84 decimal coordinates | Явно маркированная demo kitchen |
| `YANDEX_DELIVERY_ACCOUNT/CONTRACT/API_TOKEN` | Будущий доступ к Яндекс Доставке | **Не предоставлены. Нужны договор, аккаунт и API-токен с подтверждённой доступностью методов для Казахстана** | Определяется официальным кабинетом/договором | Нет — local simulator |
| Delivery zone (не env) | Согласованная production-геометрия зоны Астаны | **Не предоставлена. Нужен подтверждённый GeoJSON Polygon; demo polygon запрещён в production** | GeoJSON Polygon, WGS84 `[longitude, latitude]`; импортируется как APPROVED `DeliveryZone` через staff config/deployment seed | Версионированный `DEMO` polygon в БД; `.env` поля нет |
| `PUSH_PROVIDER_MODE` | Выбор push adapter для сервисных и opt-in marketing уведомлений | До выбора FCM/APNs-compatible поставщика production обязан оставаться `unconfigured` | Сейчас `local` или `unconfigured` | `local` |
| `PUSH_PROVIDER_PROJECT/CREDENTIALS` | Будущий project/account и signing credentials push-провайдера | **Не предоставлены; точные имена появляются вместе с adapter по официальной документации выбранного провайдера** | Provider-defined secrets из secret manager | Нет — local simulator |
| `APP_ENV` / mobile `dart-define` | Выбор Flutter runtime configuration | `dev`, `staging`, `production`; не является secret | Enum string | `dev` |
| `API_BASE_URL` / mobile `dart-define` | Публичный URL backend для Flutter | Утверждённый HTTPS URL для staging/production | Absolute URL | Android emulator получает `http://10.0.2.2:8080/api/v1` автоматически |
| Android upload key / iOS signing assets | Подпись production builds | Предоставляются владельцем через защищённый CI/signing store | Platform-defined secrets/files | Нет; debug APK не является production release |

Перед staging/production нужны два разных телефона Super Admin, выбранный SMS/OTP-провайдер и выданные им credentials, а также новые отдельные DB/Redis/S3/auth/encryption secrets. После выбора SMS-провайдера его точные переменные будут добавлены здесь вместе с adapter. Значения `local-*`, `*_local_only`, synthetic phones и local MinIO credentials использовать вне local запрещено.

Настройки refund window, renewal notice (3–5 дней), retry и business timezone являются версионированными данными `payment_settings`, а не env. Реальные payment/fiscalization credentials намеренно не выдуманы: после выбора договора точные переменные, signature verification и adapters добавляются одновременно по официальной документации. Значения simulator запрещены в production.

Этап 4 не добавляет внешних секретов. Welcome/referral/CLUB проценты, thresholds, promo limits/validity/compatibility и bonus policies являются данными System Settings со статусами `DEMO/DRAFT/ACTIVE`, а не environment variables.

Этап 5 не содержит рабочего Yandex token: реальный adapter отсутствует намеренно, а production принимает только `DELIVERY_PROVIDER_MODE=unconfigured`. После получения договора точные имена credentials, доступные методы, callback policy и ограничения polling добавляются одновременно с adapter. Лимит адресов, dispatch lead, retries, polling, слоты и capability flags являются версионированными `delivery_settings`/`delivery_slots`, а не secrets.

Этап 6 не добавляет внешних секретов. Модель принтера и драйвер не выбраны: система формирует Unicode PDF/HTML с настраиваемым размером, preview, reprint history и не заявляет аппаратную совместимость. Recipe yield/loss, min/critical stock levels, density, storage locations и supplier data являются данными БД/Admin, а не env.

Этап 7 не хранит provider credentials в `system_settings`. Cut-off, pricing, CLUB thresholds, loyalty/refund policies, support contacts, templates, label and job parameters являются версионированными business settings. Реальный push provider не выбран: local/test использует явно маркированный simulator, production остаётся `unconfigured` до отдельного adapter и secret-manager entries.

Этап 8 не добавляет backend secrets в mobile bundle. `APP_ENV` и `API_BASE_URL` — публичная build-конфигурация. Push/payment/maps public IDs добавляются только вместе с выбранными provider adapters; private keys остаются в backend/secret manager. Production signing assets не создаются автоматически.
