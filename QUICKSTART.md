# Быстрый запуск JANTOK

## Что открыть

- В Android Studio открывайте каталог `jantok-mobile/`, а не корень репозитория.
- Весь проект и Docker-инфраструктура находятся в корне `jantok/`.
- Backend: `jantok-backend/`; Admin Panel: `jantok-admin/`.

## Требования

- Docker Desktop с Compose v2;
- `make`, `curl`, `jq`, OpenSSL;
- Flutter 3.47.5 и JDK Android Studio — только для локальной mobile-разработки;
- Node.js 24 LTS — только если backend/admin запускаются вне Docker.

Проверка базовых инструментов:

```bash
docker compose version
flutter --version
```

## Первый локальный запуск с демо-данными

Из корня `jantok/`:

```bash
make setup-demo
make start
```

`setup-demo` создаёт `.env` только при его отсутствии, генерирует локальные случайные секреты, применяет миграции и загружает детерминированные демонстрационные данные. Уже заполненный `.env` не перезаписывается. `start` не удаляет БД и volumes.

URL берутся из `.env`. У безопасного шаблона значения такие:

- Admin: <http://localhost:3000>
- API readiness: <http://localhost:8080/api/v1/health/ready>
- OpenAPI UI: <http://localhost:8080/api/docs>
- OpenAPI JSON: <http://localhost:8080/api/docs-json>
- MinIO console: <http://localhost:9001>

Если порты заняты, измените `BACKEND_HOST_PORT`, `ADMIN_HOST_PORT`, `POSTGRES_HOST_PORT` и `REDIS_HOST_PORT` в локальном `.env`. В текущем проверенном окружении используются API `18080` и Admin `13000`.

Проверка состояния:

```bash
docker compose ps
curl -fsS http://localhost:8080/api/v1/health/ready | jq
```

## Local OTP

SMS в local-режиме не отправляется. Код доступен только для синтетических номеров из `OTP_LOCAL_ALLOWED_PHONES` и только через защищённый dev inbox. Используйте интерфейс приложения/Admin или пример в `README.md`. Dev inbox и simulator routes недоступны в production.

## Flutter

```bash
cd jantok-mobile
flutter pub get
flutter analyze
flutter test
flutter run --flavor dev \
  --dart-define=APP_ENV=dev \
  --dart-define=API_BASE_URL=http://10.0.2.2:8080/api/v1
```

`10.0.2.2` — bridge Android Emulator к хосту. Для физического телефона нужен доступный с устройства HTTPS/LAN URL. Не добавляйте backend secrets через `dart-define`.

Сборка уже проверенного Android debug APK:

```bash
cd jantok-mobile
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
  flutter build apk --debug --flavor dev --target-platform android-arm64
```

Готовый артефакт полного прогона: `output/stage10/jantok-dev-debug-arm64.apk`.

## Проверки

Быстрые quality gates:

```bash
./scripts/verify-local.sh
```

Полный изолированный прогон T01–T42, Flutter tests, APK и нагрузочный профиль:

```bash
make verify-stage10
```

Прогон использует только disposable Compose project `jantok_stage10_*` и удаляет только его volumes. Результаты находятся в `output/stage10/`, подробности — в `docs/TEST_REPORT.md`.

Проверка документации Этапа 11:

```bash
./scripts/verify-stage11.sh
```

## Остановка, миграции и backup

```bash
make stop
make migrate
make backup
make restore BACKUP=/absolute/path/to/backup
```

`make stop` сохраняет volumes. Не используйте `docker compose down --volumes`, если данные нужно сохранить. Restore разрешён только для local/test и требует явного подтверждения внутри script.

## Перед staging/live

1. Откройте `docs/CLIENT_DATA_REQUEST.md`.
2. Передайте секреты через secret manager или другой защищённый канал, не в Git и не в мобильное приложение.
3. Создайте отдельные staging/production БД, Redis, bucket и секреты.
4. Подключите выбранные provider adapters по официальным договорам; `unconfigured` намеренно блокирует реальные операции.
5. Выполните процедуру из `docs/DEPLOYMENT.md`.

Проект не покупает сервер/домен, не вызывает реального курьера, не списывает деньги и не публикует приложения без отдельного решения владельца.
