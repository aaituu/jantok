import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:golden_toolkit/golden_toolkit.dart';
import 'package:jantok/l10n/app_localizations.dart';
import 'package:jantok/src/api.dart';
import 'package:jantok/src/app.dart' as legacy;
import 'package:jantok/src/design_system.dart';
import 'package:jantok/src/stage8_app.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<void> capture(WidgetTester tester, String name, Widget screen) async {
    await loadAppFonts();
    await tester.binding.setSurfaceSize(const Size(390, 844));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [legacy.apiProvider.overrideWithValue(FixtureApiClient())],
        child: RepaintBoundary(
          key: const ValueKey('capture'),
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: JantokTheme.light(),
            locale: const Locale('kk'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
            ],
            home: screen,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await expectLater(
      find.byKey(const ValueKey('capture')),
      matchesGoldenFile('../output/stage8/$name.png'),
    );
    await tester.binding.setSurfaceSize(null);
  }

  testWidgets('family questionnaire screenshot', (tester) async {
    await capture(
      tester,
      'family_questionnaire',
      const QuestionnaireStage8Screen(
        memberId: 'member-1',
        memberName: 'Аружан',
      ),
    );
  });

  testWidgets('home screenshot', (tester) async {
    await capture(tester, 'home', const Scaffold(body: HomeScreen()));
  });

  testWidgets('menu member switch screenshot', (tester) async {
    await capture(
      tester,
      'menu_member_switch',
      const Scaffold(body: MenuScreen()),
    );
  });

  testWidgets('meal details allergy screenshot', (tester) async {
    await capture(
      tester,
      'meal_details_allergy',
      MealDetailsScreen(option: FixtureApiClient.option, memberId: 'member-1'),
    );
  });

  testWidgets('subscription calendar screenshot', (tester) async {
    await capture(tester, 'subscription_calendar', const SubscriptionScreen());
  });

  testWidgets('delivery tracking screenshot', (tester) async {
    await capture(
      tester,
      'delivery_tracking',
      const Scaffold(body: DeliveryScreen()),
    );
  });

  testWidgets('club screenshot', (tester) async {
    await capture(tester, 'club', const Scaffold(body: ClubDashboardScreen()));
  });

  testWidgets('checkout screenshot', (tester) async {
    await capture(tester, 'checkout', const CheckoutScreen());
  });
}

class FixtureApiClient extends ApiClient {
  FixtureApiClient() : super(const FlutterSecureStorage());

  static final meal = <String, dynamic>{
    'id': 'meal-1',
    'code': 'CHICKEN_BOWL',
    'caloriesKcal': 540,
    'servingWeightGrams': 420,
    'translations': [
      {
        'locale': 'kk',
        'name': 'Көкөністі тауық боулы',
        'description': 'Теңгерімді түскі ас',
      },
      {'locale': 'ru', 'name': 'Боул с курицей и овощами'},
      {'locale': 'en', 'name': 'Chicken vegetable bowl'},
    ],
    'ingredients': [
      {
        'ingredient': {'code': 'CHICKEN', 'nameRu': 'Курица'},
      },
      {
        'ingredient': {'code': 'RICE', 'nameRu': 'Рис'},
      },
      {
        'ingredient': {'code': 'SESAME', 'nameRu': 'Кунжут'},
      },
    ],
    'allergenRisks': [
      {
        'allergen': {'code': 'SESAME', 'nameRu': 'Кунжут'},
      },
    ],
    'reviews': [
      {'rating': 5, 'comment': 'Дәмді әрі тойымды'},
      {'rating': 4, 'comment': 'Свежие овощи'},
    ],
  };

  static final option = <String, dynamic>{
    'id': 'option-1',
    'mealType': 'LUNCH',
    'meal': meal,
    'memberSafety': [
      {
        'memberId': 'member-1',
        'safe': false,
        'reasons': ['MEAL_ALLERGEN_CONTAINS:SESAME'],
      },
      {'memberId': 'member-2', 'safe': true, 'reasons': <String>[]},
    ],
  };

  static final household = <String, dynamic>{
    'id': 'household-1',
    'onboardingStep': 'COMPLETED',
    'members': [
      {
        'id': 'member-1',
        'firstName': 'Аружан',
        'birthDate': '1991-05-12T00:00:00.000Z',
      },
      {
        'id': 'member-2',
        'firstName': 'Алихан',
        'birthDate': '2017-02-03T00:00:00.000Z',
      },
    ],
    'addresses': [
      {'id': 'address-1', 'label': 'Үй'},
    ],
  };

  static final subscription = <String, dynamic>{
    'id': 'subscription-1',
    'status': 'ACTIVE',
    'startDate': '2026-09-20T00:00:00.000Z',
    'currentEndDate': '2026-10-19T00:00:00.000Z',
    'autoRenew': true,
    'serviceDays': List.generate(10, (index) {
      final date = DateTime(2026, 9, 20).add(Duration(days: index));
      return {
        'id': 'day-$index',
        'serviceDate': date.toIso8601String(),
        'status': index == 0 ? 'DELIVERED' : 'PLANNED',
        if (index == 0)
          'dailyFulfillment': {'id': 'delivery-1', 'status': 'ON_THE_WAY'},
      };
    }),
  };

  @override
  Future<Map<String, dynamic>> call(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    if (path == '/household') return household;
    if (path == '/subscriptions/current') return subscription;
    if (path.startsWith('/menu')) {
      return {
        'days': List.generate(7, (index) {
          final date = DateTime(2026, 9, 25).add(Duration(days: index));
          return {
            'serviceDate': date.toIso8601String().split('T').first,
            'serviceDayStatus': 'PLANNED',
            'options': [option],
          };
        }),
      };
    }
    if (path == '/loyalty/club') {
      return {
        'wallet': {'availableKzt': 18400, 'reservedKzt': 1200},
        'membership': {
          'qualifyingPaidCycles': 5,
          'tier': {'nameRu': 'Silver'},
        },
        'nextTier': {'thresholdPaidCycles': 6},
        'referralCode': 'ARUZHAN24',
        'invitedFriends': [
          {'displayName': 'Д.', 'status': 'QUALIFIED'},
          {'displayName': 'М.', 'status': 'REGISTERED'},
        ],
      };
    }
    if (path.contains('/tracking')) {
      return {
        'status': 'ON_THE_WAY',
        'slot': '07:00–09:00',
        'financialStatus': 'PAID',
        'courier': {'phone': '+77000000000'},
        'tracking': {'latitude': 51.1282, 'longitude': 71.4304},
        'eta': {'eta': '08:12'},
      };
    }
    if (path == '/catalogs/questionnaire') {
      return {
        'activityLevels': [
          {
            'id': 'activity-1',
            'nameKk': 'Орташа белсенділік',
            'nameRu': 'Средняя активность',
            'nameEn': 'Moderate activity',
          },
        ],
        'dietTypes': [
          {
            'id': 'diet-1',
            'nameKk': 'Теңгерімді',
            'nameRu': 'Сбалансированное',
            'nameEn': 'Balanced',
          },
        ],
        'allergens': [
          {
            'id': 'allergen-1',
            'nameKk': 'Күнжіт',
            'nameRu': 'Кунжут',
            'nameEn': 'Sesame',
          },
        ],
        'sportTypes': [
          {'id': 'sport-1', 'nameRu': 'Бег'},
        ],
        'ingredients': [
          {'id': 'ingredient-1', 'nameRu': 'Лук'},
        ],
      };
    }
    if (path == '/support/notification-preferences') {
      return {
        'servicePushEnabled': true,
        'marketingPushEnabled': false,
        'locale': 'kk',
      };
    }
    return <String, dynamic>{};
  }

  @override
  Future<List<dynamic>> callList(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async => <dynamic>[];
}
