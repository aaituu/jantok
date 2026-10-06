# Stage 8: Flutter launch and release status

## Runtime configuration

The mobile client reads only public build-time values. Backend secrets, provider signing keys and private credentials must never be passed through `dart-define`.

| Define | Values | Rule |
| --- | --- | --- |
| `APP_ENV` | `dev`, `staging`, `production` | Defaults to `dev` |
| `API_BASE_URL` | absolute API URL | Optional in dev; mandatory and HTTPS-only in staging/production |

Dev defaults are platform-aware: Android uses `http://10.0.2.2:8080/api/v1`; iOS simulator/macOS uses `http://localhost:8080/api/v1`. A physical device must receive an address reachable from that device, for example a business-approved tunnel. No personal LAN IP is committed.

Example commands:

```bash
flutter run --flavor dev --dart-define=APP_ENV=dev
flutter run --flavor dev --dart-define=APP_ENV=dev --dart-define=API_BASE_URL=http://REACHABLE_HOST:8080/api/v1
flutter build apk --debug --flavor dev --target-platform android-arm64 --dart-define=APP_ENV=dev
flutter build appbundle --release --flavor production --dart-define=APP_ENV=production --dart-define=API_BASE_URL=https://APPROVED_API_HOST/api/v1
```

Production release builds intentionally have no checked-in signing configuration. The owner or release CI must provide the Android upload key and iOS signing assets.

## Platform status

- Android project, dev/staging/production flavors, Internet/Android notification permissions and `jantok://payment-return` deep link are configured.
- Cleartext traffic is enabled only by the Android debug manifest. Application configuration independently rejects non-HTTPS staging/production URLs.
- iOS project and permission descriptions for camera/photo support are present. Local networking is allowed for simulator development; arbitrary HTTP hosts are not enabled.
- A custom checkout-return URL scheme is registered for iOS. Universal-link associated domains must be added only after the business confirms the production domain and serves the Apple association file.
- Push, payment and maps SDK insertion points remain provider-dependent. No private provider key belongs in the app bundle.

## Verification performed on 2026-09-27

- `flutter analyze`: passed.
- Flutter widget and localization-switch tests: passed.
- Eight golden screenshots: generated and verified at 390×844.
- Android arm64 dev debug APK: built successfully at `output/stage10/jantok-dev-debug-arm64.apk`. It is debug-signed and is not a production release. SHA-256: `e70f360c76479f3736fa899488e09f938408e76359ac19736ce773e4acf7bbf5`.
- No Android emulator or physical Android device was available, so installation/runtime-on-device was not claimed.
- iOS source structure is present, but the host has incomplete Xcode and no CocoaPods. iOS compilation and signing were therefore not performed.

Before an iOS build, install full Xcode and CocoaPods, select Xcode with `xcode-select`, run first-launch setup, configure the team/bundle identifier and provider entitlements, then run:

```bash
flutter build ios --no-codesign --dart-define=APP_ENV=staging --dart-define=API_BASE_URL=https://APPROVED_STAGING_API/api/v1
```

## Brand and content status

No approved JANTOK logo, palette or licensed food-photo assets were found in the repository or supplied attachment. The application therefore uses a replaceable text wordmark, centralized neutral Material design tokens, and an explicit no-photo fallback. These must be replaced only after approved brand assets are supplied.

The runtime mobile interface uses ARB localization for kk/ru/en, with Kazakh as the default. Backend-translated catalog/menu content uses its localized columns/tables and falls back kk → ru → code rather than showing internal translation keys.
