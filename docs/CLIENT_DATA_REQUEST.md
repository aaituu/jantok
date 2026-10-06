# Что нужно прислать владельцу JANTOK для live-запуска

## Важно о безопасности

Для локального запуска сейчас ничего присылать не нужно: проект работает с безопасными симуляторами и демо-данными.

**Не отправляйте пароли, private keys, файлы `.p8`, service-account JSON, банковские ключи или заполненный `.env` в обычный чат, Git, email без шифрования или мобильное приложение.** Передавайте их через согласованный secret manager/защищённое хранилище. В чате достаточно сообщить, что доступ создан, название поставщика и несекретные ID.

Не нужны и не должны присылаться: данные банковских карт клиентов, CVV, реальные OTP, фотографии/анкеты реальных клиентов или текущие пароли личных аккаунтов.

## Короткий приоритет

1. Для первого внешнего staging: сервер/домен, отдельные DB/Redis/storage, два Super Admin, выбранные provider sandbox accounts.
2. Для live-операций: SMS, эквайринг, фискализация, Яндекс Доставка, push и утверждённые бизнес-настройки.
3. Для публикации: Google Play/Apple Developer, signing, store тексты/скриншоты/privacy URLs.

## 1. Владелец и доступ к коду

### Два номера Super Admin

- **Что:** два разных номера руководителей/ответственных сотрудников в международном формате `+7…`.
- **Зачем:** создать два независимых аккаунта с максимальными правами; система не разрешает остаться без последнего Super Admin.
- **Где получают:** это действующие номера владельца и резервного ответственного лица.
- **Когда:** до первого production запуска; для staging желательно использовать отдельные корпоративные тестовые номера.
- **Поля:** `SUPER_ADMIN_PHONE_1`, `SUPER_ADMIN_PHONE_2`.

### Git-репозиторий и hosted CI

- **Что:** GitHub/GitLab repository, куда владелец разрешает push, и право запускать CI.
- **Зачем:** подтвердить зелёный hosted pipeline, хранить историю и build artifacts.
- **Где получают:** создаётся в организации владельца; достаточно выдать доступ разработчику/CI, пароль присылать не нужно.
- **Когда:** до первого staging deployment.
- **Поле:** не `.env`; это настройка Git remote и CI permissions.

## 2. Сервер, домен и TLS

### VPS/сервер или выбранная cloud-платформа

- **Что:** Linux host/managed container platform, его адрес и защищённый SSH/deployment access.
- **Зачем:** запустить backend, worker, admin и edge proxy.
- **Где получают:** у выбранного hosting/cloud provider после покупки владельцем.
- **Когда:** после покупки сервера, до staging/live deployment.
- **Поле:** не `.env`; host/user/key задаются в deployment system. Private SSH key хранится в secret manager.

### Домен

- **Что:** утверждённый домен, например `app.company.kz`, и доступ изменить DNS.
- **Зачем:** HTTPS API/Admin, CORS, mobile production URL, WebSocket, universal links.
- **Где получают:** у регистратора домена; DNS управляется в его кабинете или DNS provider.
- **Когда:** до внешнего staging; обязательно до store publication/universal links.
- **Поля:** `JANTOK_DOMAIN`, `CORS_ORIGINS`, `NEXT_PUBLIC_API_BASE_URL`; mobile public define `API_BASE_URL`.

### TLS certificate

- **Что:** certificate chain и private key для домена либо разрешение автоматически выпустить их на сервере.
- **Зачем:** HTTPS для API/Admin/WebSocket.
- **Где получают:** у корпоративного CA или ACME/Let’s Encrypt после настройки DNS.
- **Когда:** после домена и сервера, до внешнего доступа.
- **Поле:** не строка `.env`; файлы монтируются в Nginx, домен берётся из `JANTOK_DOMAIN`.

## 3. Отдельные production-хранилища

### PostgreSQL

- **Что:** host, port, database, отдельный user/password и правила backup.
- **Зачем:** все аккаунты, подписки, деньги, заказы, склад и audit.
- **Где получают:** в кабинете managed PostgreSQL или у администратора сервера.
- **Когда:** до staging/live migration.
- **Поля:** `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`.

### Redis

- **Что:** отдельный Redis endpoint с паролем/TLS, если поддерживается.
- **Зачем:** очереди worker, OTP/rate limits, locks/cache.
- **Где получают:** managed Redis или у администратора сервера.
- **Когда:** до staging/live запуска.
- **Поле:** `REDIS_URL`.

### Object storage

- **Что:** private S3-compatible bucket, region, endpoint и service account с минимальными правами.
- **Зачем:** support-фото и другие вложения, backup/restore.
- **Где получают:** в кабинете S3/cloud storage provider; создать отдельный bucket для каждого окружения.
- **Когда:** до staging/live запуска с вложениями.
- **Поля:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

### Retention backup

- **Что:** сколько дней хранить backup, куда выгружать и кто получает alert о failure.
- **Зачем:** восстановление PostgreSQL и файлов.
- **Где получают:** решение владельца/ответственного за эксплуатацию.
- **Когда:** до live-запуска.
- **Поля:** `BACKUP_RETENTION_DAYS`; путь local `LOCAL_BACKUP_DIR` не является production backup destination.

## 4. Системные секреты приложения

- **Что:** независимые длинные случайные ключи для access token, refresh/session, OTP hash и шифрования персональных integration values.
- **Зачем:** подпись/проверка сессий, защита кодов и ciphertext.
- **Где получают:** генерируются на deployment host/secret manager; владелец не должен придумывать их вручную.
- **Когда:** отдельно для staging и production перед первым запуском.
- **Поля:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET`, `OTP_HASH_SECRET`, `PII_ENCRYPTION_KEY`.

Нельзя повторно использовать local values или один ключ во всех полях/окружениях.

## 5. SMS для OTP

- **Что:** выбранный SMS provider, договор/аккаунт, sender name, approved OTP template, API access и ограничения для Казахстана.
- **Зачем:** отправлять реальные коды входа.
- **Где получают:** в кабинете/у менеджера выбранного SMS provider после регистрации бизнеса и согласования sender/template.
- **Когда:** до первого staging теста реальной SMS-отправки; обязательно до live login.
- **Поле:** сейчас `OTP_PROVIDER_MODE=unconfigured`. Точные credential fields **намеренно отсутствуют**, потому что поставщик не выбран; они будут добавлены вместе с adapter строго по его документации.

Дополнительно нужны: тестовый recipient, rate/price limits, delivery status API и контакт поддержки provider. Локальный OTP уже проверен, но он не отправляет SMS.

## 6. Приём банковских платежей

- **Что:** выбранный банк/PSP, merchant ID/account, sandbox и production API access, webhook verification rules, allowed callback URLs, tokenization/mandate/autopay capability и refund API.
- **Зачем:** checkout, сохранённые способы оплаты, автопродление, reconciliation и возвраты.
- **Где получают:** после договора эквайринга в кабинете/у integration manager выбранного provider.
- **Когда:** sandbox — до первого внешнего payment test; production credentials — только перед live-платежами.
- **Поле:** сейчас `PAYMENT_PROVIDER_MODE=unconfigured`. После выбора появится именованный mode и точные поля из официальной документации; `PAYMENT_SIMULATOR_WEBHOOK_SECRET` — только local и банку не передаётся.

Нужно письменно подтвердить: валюту KZT, partial/multiple refunds, webhook retry/signature, saved token/mandate, 3-D Secure/redirect, operation lookup после timeout и Казахстан.

## 7. Фискализация

- **Что:** выбранная онлайн-ККМ/ОФД схема, организация/ИП, аккаунт/ключи, касса/точка, налоговый режим, ставки/предмет расчёта и правила отправки чека клиенту.
- **Зачем:** сформировать законный чек продажи и возвратный документ.
- **Где получают:** у выбранного фискального provider/ОФД после регистрации кассы и договора; юридические параметры подтверждает бухгалтер/юрист.
- **Когда:** до live денежных операций.
- **Поле:** сейчас `FISCALIZATION_PROVIDER_MODE=unconfigured`. Точные credential fields добавляются только после выбора provider; local simulator выдаёт исключительно тестовый нефискальный документ.

## 8. Яндекс Доставка

### Договор и API access

- **Что:** договор/аккаунт Яндекс Доставки, API token и ID договора/клиента, если выдаётся.
- **Зачем:** расчёт, создание/отмена доставки, статусы, courier/tracking/ETA — только в пределах доступных договору методов.
- **Где получают:** у менеджера Яндекс Доставки; token обычно выдаётся в личном кабинете на вкладке Integration после активации доступа: <https://yandex.com/support/delivery-profile/en/api/express/quickstart>.
- **Когда:** sandbox/test access до интеграционного теста; production access перед live courier dispatch.
- **Поле:** сейчас `DELIVERY_PROVIDER_MODE=unconfigured`; точные Yandex credential fields добавляются с официальным adapter. `DELIVERY_SIMULATOR_WEBHOOK_SECRET` — только local.

Нужно отдельно подтвердить для договора в Казахстане: webhook или polling, signature, create/cancel/status methods, phone masking, courier location, tracking link, ETA, retry/rate limits.

### Адрес кухни

- **Что:** точный адрес точки выдачи, координаты WGS84 и инструкции курьеру.
- **Зачем:** pickup point заказа.
- **Где получают:** фактическая кухня; координаты сверяются владельцем на карте.
- **Когда:** до первого реального delivery test.
- **Поля:** `DELIVERY_PICKUP_ADDRESS`, `DELIVERY_PICKUP_LATITUDE`, `DELIVERY_PICKUP_LONGITUDE`.

### Зона доставки

- **Что:** утверждённая точная граница зоны Астаны как GeoJSON Polygon/MultiPolygon `[longitude, latitude]`.
- **Зачем:** backend принимает адрес только внутри подтверждённой геометрии.
- **Где получают:** бизнес/операционный руководитель и GIS/карта; не строка «Астана» и не прямоугольник.
- **Когда:** до live заказа.
- **Поле:** не `.env`; GeoJSON импортируется как подтверждённая `DeliveryZone` через staff/deployment config. Текущая demo zone хранится в БД и запрещена production.

## 9. Push-уведомления

- **Что:** выбор FCM/APNs или агрегатора; Firebase project ID/service account для server send; iOS APNs key/team ID/key ID; Android/iOS public app configuration.
- **Зачем:** сервисные уведомления, renewal notice и отдельно согласованный marketing.
- **Где получают:** Firebase Console → Project settings/Service accounts (<https://firebase.google.com/docs/admin/setup>); APNs key создаёт Account Holder/Admin в Apple Developer account (<https://developer.apple.com/help/account/keys/create-a-private-key>).
- **Когда:** staging push test перед публикацией; production keys до live notifications.
- **Поле:** сейчас `PUSH_PROVIDER_MODE=unconfigured`. Точные server credential fields добавляются с adapter; private keys остаются в secret manager, public platform files — в соответствующих protected release configs.

### Карты и tracking в мобильном приложении

- **Что:** решение, используется ли карта/SDK выбранного поставщика либо только tracking link Яндекс Доставки; если нужен SDK — mobile app ID/public API key и разрешённые package/bundle IDs.
- **Зачем:** показать реальное положение/маршрут только когда provider действительно отдаёт эти данные; без этого приложение использует честный status/ETA/tracking-link fallback.
- **Где получают:** в кабинете выбранного картографического поставщика и по возможностям договора доставки. Private server credentials не включаются в приложение.
- **Когда:** до staging-проверки карты; не требуется для первого локального запуска.
- **Поле:** сейчас отдельного поля в `.env.example` нет, потому что поставщик не выбран. Публичные mobile IDs будут добавлены в release config/`dart-define` одновременно с официальным SDK; server secret — в secret manager.

## 10. Google Play

- **Что:** Google Play Developer account/app record, утверждённый package ID, Play App Signing, upload keystore/alias/passwords и право загружать AAB.
- **Зачем:** подписывать release AAB и публиковать Android.
- **Где получают:** Play Console; официальный Play App Signing разделяет upload key владельца и app signing key Google: <https://support.google.com/googleplay/android-developer/answer/9842756>.
- **Когда:** только перед internal/closed testing и публикацией; для текущего debug APK не нужно.
- **Поле:** не `.env`; secrets — в CI signing store/Gradle secrets. `API_BASE_URL` и `APP_ENV=production` передаются как публичная build-конфигурация.

## 11. Apple/App Store

- **Что:** Apple Developer Program team, утверждённый bundle ID, certificates/profiles или managed signing, App Store Connect app record; при автоматизации — API issuer/key ID и private `.p8`.
- **Зачем:** собрать iOS, TestFlight и App Store release.
- **Где получают:** Apple Developer и App Store Connect. Team API key создаёт Admin в Users and Access → Integrations: <https://developer.apple.com/documentation/AppStoreConnectAPI/creating-api-keys-for-app-store-connect-api>.
- **Когда:** только перед iOS device/TestFlight/store проверкой.
- **Поле:** не `.env`; signing хранится в Keychain/CI secret store. Mobile использует публичные `APP_ENV` и `API_BASE_URL`.

## 12. Бизнес-решения — не секреты

Эти данные вносятся через Admin/System Settings и справочники со статусом `DRAFT`, затем утверждаются. Они не должны становиться env secrets.

### Цены и состав подписки

Нужны:

- реальные цены по adult/child и возрастным категориям;
- что входит в 30 service days;
- family discounts и правила округления;
- цена guest day, permanent member proration, большие порции и платные additions;
- цены one-off/recurring add-ons и скидка recurring;
- применимость/совместимость promo и минимальные суммы.

Куда: `PRICING.RULES`, promo/add-on Admin. Текущие суммы — только DEMO.

### Нормы питания и безопасность

Нужны утверждённым специалистом:

- нормы энергии/БЖУ по возрасту, полу, активности, спорту и цели;
- adult/child portion rules;
- список diets/allergens/tags и допустимые замены/исключения;
- реальные рецепты, граммовки, состав, nutrition, yield/loss и аллергенные риски;
- подтверждение global halal policy.

Куда: Nutrition Rules, meals/ingredients/recipes. DEMO rules не являются медицинской рекомендацией и production их не выбирает.

### Cut-off и service policy

Подтвердить:

- 13:00 payment/menu, 14:00 skip/pause/address, 15:00 add-on, 15:05 kitchen lock;
- business timezone `Asia/Almaty`;
- календарные/выходные/праздничные service days;
- лимит pause, правила skip, guest/member changes и administrative exceptions.

Куда: `CUTOFF.POLICY` и subscription settings.

### Refund/autorenew

Подтвердить:

- точную границу первых 7 календарных дней от первой подтверждённой доставки;
- формулу unused part и handling add-ons/доплат;
- роли/лимиты административной компенсации;
- точное renewal notice окно 3–5 дней;
- количество/интервалы payment retry и manual action policy.

Куда: `payment_settings`/System Settings.

### Welcome, referral и JANTOK CLUB

Подтвердить:

- welcome 10% и база расчёта после скидок;
- referral tiers: количество оплаченных друзей, процент/фиксированная база каждой новой награды;
- CLUB names, thresholds оплаченных 30-day cycles, coefficients/benefits;
- влияние full/partial refund;
- политика отрицательного обязательства, если отменённые бонусы уже потрачены.

Куда: `LOYALTY`, referral tiers, CLUB levels. Иллюстративные tiers не production default.

### Доставка и кухня

Подтвердить:

- три слота 06:00–08:00, 07:00–09:00, 08:00–10:00;
- dispatch lead, retry/poll intervals и действия при NO_ANSWER/DELIVERY_FAILED;
- точку кухни и delivery zone;
- места хранения, units/density, min/critical stock;
- suppliers, purchase/acceptance process, waste reasons;
- источник и состав фактической стоимости доставки для аналитики и gross margin;
- размер этикетки и модель принтера, если нужна прямая печать.

Куда: delivery/kitchen/inventory settings и справочники. Без модели принтера остаются рабочие PDF/HTML.

### Сотрудники, роли и пределы полномочий

Нужны список действующих сотрудников, рабочий телефон/имя, назначенная роль, кто может делать refund, bonus correction, cut-off override, warehouse correction, export и менять System Settings. Для финансовых действий нужны лимиты суммы и порядок согласования. Личные пароли передавать не нужно: сотрудники входят через штатный OTP/session flow.

Куда: Employees/Roles/Permissions в Admin Panel; это данные БД, не `.env`. Два владельца Super Admin отдельно задаются полями `SUPER_ADMIN_PHONE_1` и `SUPER_ADMIN_PHONE_2` до production запуска.

### Формулы аналитики и управленческие цели

Нужно утвердить для каждого бизнес-показателя период/timezone, числитель и знаменатель, учитываемые статусы, возвраты, бонусы и налоги. Отдельно подтвердить определения revenue, active/paying customer, churn, retention, LTV, on-time delivery, food cost, delivery cost и gross margin, а также допустимые сроки готовности больших экспортов.

Куда: Analytics/System Settings и документированная metric policy; это не `.env`. До утверждения отчёты используют явно описанную локальную рабочую формулу и не считаются бухгалтерской отчётностью.

### Support, notifications и retention

Нужны support phone/email/hours, escalation contacts, тексты service/marketing уведомлений kk/ru/en, consent wording, сроки хранения support-фото/audit/export/backup, правила удаления аккаунта/персональных данных и юридический contact. Отдельно нужны approved phone для кнопки звонка, ответственные за недоставку/качество и адресаты alerts о failed jobs/backups/providers.

Куда: System Settings, templates и operational policy.

### Тестовые участники staging

Нужны разрешённые корпоративные тестовые номера для OTP/provider sandbox, сотрудники для проверки каждой ограниченной роли и ответственный, который принимает payment/refund/delivery/push тесты. Реальные клиентские данные для этого не нужны.

Куда: sandbox allowlists и staging Admin; при необходимости номера для local sink перечисляются в `OTP_LOCAL_ALLOWED_PHONES`, но production-клиенты туда не добавляются.

## 13. Бренд и контент

### Бренд-ассеты

- основной/монохромный logo в SVG и PNG;
- app icon/master artwork;
- утверждённые цвета HEX, typography/font licenses;
- splash/illustrations и лицензированные food photos;
- правила использования бренда.

Когда: до финальной visual QA и store screenshots. Сейчас используются временный text wordmark, нейтральные tokens и photo fallback. Не `.env`.

### Локализованный контент

Нужны утверждённые kk/ru/en названия/описания блюд, ingredients, allergens, add-ons, empty/error/support тексты и юридические формулировки. Не `.env`; загружается как catalog/settings data.

## 14. Store и юридические материалы

Для Google Play и App Store нужны:

- название, subtitle/short и full description kk/ru/en;
- keywords/category/age rating и contact email;
- screenshots/feature graphic/app preview по требованиям stores;
- privacy policy URL, Terms/offer URL, support URL;
- account deletion URL/instructions;
- ответы Data Safety/App Privacy о собираемых данных;
- юридическое имя, адрес и реквизиты продавца;
- reviewer test account/инструкция без реального списания;
- локализованные release notes.

Когда: только перед store submission. Не `.env`; это store console/content и public web pages.

## Что уже решено и повторно присылать не нужно

- схема backend, payments/refunds/bonus/delivery/kitchen domain;
- локальные simulators и demo seed;
- T01–T42, backup/restore scripts, Docker/CI structure;
- три языка UI и текущие layout/golden artifacts;
- debug APK;
- interface будущих providers.

## Следующая сессия после получения данных

Когда эти данные и доступы будут предоставлены, следующая сессия должна **только безопасно подставить их в `.env`/secret store и конфигурации и перепроверить staging/live интеграции**. Если выбранному поставщику требуется ещё отсутствующий технический adapter, он добавляется исключительно в готовом integration layer через существующий interface и по официальной документации. Уже готовую бизнес-логику платежей, подписок, bonus ledger, возвратов, delivery, kitchen/inventory и RBAC **переписывать не нужно и нельзя без отдельного нового требования**.
