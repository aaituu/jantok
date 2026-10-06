# Готовность iOS

## Итог

iOS source composition сохранён и общая Flutter/domain логика не зависит от Android. **iOS build и запуск не подтверждены**, потому что на проверочном Mac установлен только Command Line Tools, полный Xcode отсутствует и CocoaPods не установлен.

Это отличается от Android: Android ARM64 debug APK успешно собран, но Android emulator/device также отсутствовал. Факт сборки и факт запуска не смешиваются.

## Что уже есть

- `jantok-mobile/ios/Runner.xcodeproj` и `Runner.xcworkspace`;
- `AppDelegate.swift`, `SceneDelegate.swift`, generated plugin registrant;
- bundle identifier placeholder/current value `kz.jantok.jantok`;
- localizations `kk`, `ru`, `en` в `Info.plist`;
- camera/photo permission descriptions только для support attachment;
- custom callback scheme `jantok://payment-return`;
- local networking permission для simulator development;
- Flutter secure storage, image picker и URL launcher имеют cross-platform packages;
- production API configuration требует HTTPS;
- backend business logic, pricing, safety, payment confirmation и state machines находятся на сервере.

## Platform-specific Dart

`dart:io` используется только для:

- platform-aware local API default (`10.0.2.2` Android, `localhost` iOS/macOS);
- неперсонального device identifier suffix;
- file upload abstraction.

Android-only SDK/MethodChannel в общем domain не найден. Системный звонок использует portable `tel:` URL. Provider-specific payment/push/maps SDK пока не добавлен ни на одной платформе.

## Что не проверено

- `flutter build ios --no-codesign`;
- compilation native plugins и Swift Package Manager/CocoaPods resolution;
- запуск на iOS Simulator/physical iPhone;
- camera/photo permission UX на реальном iOS;
- checkout callback после background/terminated state;
- APNs registration, token rotation и notification tap;
- universal links/Associated Domains;
- keychain persistence после обновления/переустановки согласно release policy;
- App Store archive, signing, TestFlight и review metadata.

## Текущее состояние host tools

Проверено 2026-09-27:

- Flutter 3.47.5 / Dart 3.13.4;
- `xcode-select` указывает на `/Library/Developer/CommandLineTools`;
- `xcodebuild` сообщает, что нужен полный Xcode;
- `pod` отсутствует;
- `flutter doctor -v` помечает Xcode toolchain как incomplete.

## Что нужно владельцу установить/предоставить

1. Полный Xcode совместимой версии и first-launch components.
2. Apple Developer Program team с правом создавать identifiers/certificates/profiles.
3. Утверждённый bundle ID; менять его после provider/store setup следует только осознанно.
4. Development/distribution signing через Xcode managed signing либо защищённый CI.
5. App Store Connect app record и, для CI automation, API key с минимальной ролью.
6. Production domain для Universal Links и файл `apple-app-site-association`.
7. Push решение: Firebase/APNs, APNs key/team ID/key ID и entitlements.
8. Approved privacy policy/support/account deletion URLs и store content.

Private `.p8`, certificates, provisioning profiles и App Store Connect keys нельзя коммитить или передавать в Flutter bundle.

## Порядок будущей проверки

После установки Xcode:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
cd jantok-mobile
flutter doctor -v
flutter pub get
flutter build ios --no-codesign \
  --dart-define=APP_ENV=staging \
  --dart-define=API_BASE_URL=https://APPROVED_STAGING_API/api/v1
```

Затем:

1. запустить staging build на simulator;
2. пройти OTP → checkout return → support photo → delivery tracking;
3. проверить denied camera/photo permission и offline/reconnect;
4. собрать signed archive для internal TestFlight;
5. проверить APNs/universal link на physical device;
6. сохранить команды/результаты в `docs/TEST_REPORT.md`.

## Release blocker status

| Область | Статус |
| --- | --- |
| Общая Flutter codebase | `LOCAL_VERIFIED` через analyze/widget/golden tests |
| iOS project structure/localizations/permissions | `SOURCE_READY` |
| iOS compile | `BLOCKED_EXTERNAL_TOOLING` |
| Simulator/device runtime | `BLOCKED_EXTERNAL_TOOLING` |
| Signing/TestFlight/App Store | `BLOCKED_EXTERNAL_OWNER_DATA` |
| APNs/universal links | `BLOCKED_EXTERNAL_PROVIDER_AND_DOMAIN` |
