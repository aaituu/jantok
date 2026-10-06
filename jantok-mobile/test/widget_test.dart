import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jantok/src/app.dart' hide JantokApp;
import 'package:jantok/src/stage8_app.dart';

void main() {
  testWidgets('shows login when there is no persisted session', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authProvider.overrideWith(TestAuthController.new),
          onboardingProvider.overrideWith(TestOnboardingController.new),
          localeProvider.overrideWith(TestLocaleController.new),
        ],
        child: const JantokApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('JANTOK-қа кіру'), findsOneWidget);
    expect(find.text('Кодты алу'), findsOneWidget);
  });

  testWidgets('switches kk to en without restarting the app', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authProvider.overrideWith(TestAuthController.new),
          onboardingProvider.overrideWith(TestPendingOnboardingController.new),
          localeProvider.overrideWith(TestSwitchableLocaleController.new),
        ],
        child: const JantokApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Отбасыңызға арналған күнделікті ас'), findsOneWidget);
    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();
    expect(find.text('Daily meals for your family'), findsOneWidget);
  });
}

class TestAuthController extends AuthController {
  @override
  Future<bool> build() async => false;
}

class TestOnboardingController extends OnboardingController {
  @override
  Future<bool> build() async => true;
}

class TestLocaleController extends LocaleController {
  @override
  Future<Locale> build() async => const Locale('kk');
}

class TestPendingOnboardingController extends OnboardingController {
  @override
  Future<bool> build() async => false;
}

class TestSwitchableLocaleController extends LocaleController {
  @override
  Future<Locale> build() async => const Locale('kk');

  @override
  Future<void> select(String code) async {
    state = AsyncData(Locale(code));
  }
}
