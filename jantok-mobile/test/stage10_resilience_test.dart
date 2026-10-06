import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jantok/l10n/app_localizations.dart';
import 'package:jantok/src/api.dart';
import 'package:jantok/src/app.dart' as legacy;
import 'package:jantok/src/design_system.dart';
import 'package:jantok/src/stage8_app.dart';

void main() {
  Future<void> pumpLogin(
    WidgetTester tester, {
    Locale locale = const Locale('kk'),
    Size size = const Size(320, 568),
  }) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          legacy.apiProvider.overrideWithValue(OfflineApiClient()),
          legacy.authProvider.overrideWith(TestAuthController.new),
        ],
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: JantokTheme.light(),
          locale: locale,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
          ],
          home: const LoginScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  for (final locale in const [Locale('kk'), Locale('ru'), Locale('en')]) {
    testWidgets('${locale.languageCode} renders on a 320px screen', (
      tester,
    ) async {
      await pumpLogin(tester, locale: locale);
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byType(CompactLanguagePicker), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('keyboard does not overflow the small-screen login flow', (
    tester,
  ) async {
    await pumpLogin(tester);
    final phone = find.byType(TextField).first;
    await tester.tap(phone);
    await tester.showKeyboard(phone);
    await tester.enterText(phone, '+77000000001');
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  testWidgets('offline OTP failure is visible and keeps the form usable', (
    tester,
  ) async {
    await pumpLogin(tester);
    final sendCode = find.text('Кодты алу');
    await tester.ensureVisible(sendCode);
    await tester.tap(sendCode);
    await tester.pumpAndSettle();
    expect(find.text('Желі жоқ — кейін қайталап көріңіз'), findsOneWidget);
    expect(find.byType(TextField), findsNWidgets(4));
    expect(tester.takeException(), isNull);
  });
}

class OfflineApiClient extends ApiClient {
  OfflineApiClient() : super(const FlutterSecureStorage());

  @override
  Future<String> deviceId() async => 'stage10-offline-device';

  @override
  Future<Map<String, dynamic>> call(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    throw ApiException('OFFLINE', 'Желі жоқ — кейін қайталап көріңіз');
  }
}

class TestAuthController extends legacy.AuthController {
  @override
  Future<bool> build() async => false;
}
