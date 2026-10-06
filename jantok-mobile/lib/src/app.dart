import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';

final storageProvider = Provider((_) => const FlutterSecureStorage());
final apiProvider = Provider((ref) => ApiClient(ref.watch(storageProvider)));
final authProvider = AsyncNotifierProvider<AuthController, bool>(
  AuthController.new,
);

class AuthController extends AsyncNotifier<bool> {
  @override
  Future<bool> build() => ref.read(apiProvider).refresh();

  Future<void> verify(
    String phone,
    String code,
    String first,
    String last,
    String referral,
  ) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final api = ref.read(apiProvider);
      final data = await api.call(
        'POST',
        '/auth/otp/verify',
        authenticated: false,
        body: {
          'phone': phone,
          'code': code,
          'deviceId': await api.deviceId(),
          'deviceName': 'JANTOK mobile',
          if (first.trim().isNotEmpty) 'firstName': first.trim(),
          if (last.trim().isNotEmpty) 'lastName': last.trim(),
          if (referral.trim().isNotEmpty)
            'referralCode': referral.trim().toUpperCase(),
        },
      );
      await api.saveTokens(data);
      return true;
    });
  }

  Future<void> logout() async {
    final api = ref.read(apiProvider);
    try {
      await api.call('DELETE', '/auth/sessions/current');
    } finally {
      await api.clear();
      state = const AsyncData(false);
    }
  }
}

class JantokApp extends ConsumerWidget {
  const JantokApp({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp(
    title: 'JANTOK Food',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF176B4D)),
      useMaterial3: true,
    ),
    home: const AuthGate(),
  );
}

class AuthGate extends ConsumerWidget {
  const AuthGate({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref
      .watch(authProvider)
      .when(
        data: (signedIn) =>
            signedIn ? const HouseholdScreen() : const LoginScreen(),
        loading: () =>
            const Scaffold(body: Center(child: CircularProgressIndicator())),
        error: (error, _) => LoginScreen(initialError: '$error'),
      );
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key, this.initialError});
  final String? initialError;
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final phone = TextEditingController(text: '+77000000001');
  final code = TextEditingController(),
      first = TextEditingController(),
      last = TextEditingController(),
      referral = TextEditingController();
  String? message;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Вход в JANTOK')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        TextField(
          controller: phone,
          decoration: const InputDecoration(labelText: 'Телефон в формате +7…'),
        ),
        TextField(
          controller: first,
          decoration: const InputDecoration(labelText: 'Имя (при регистрации)'),
        ),
        TextField(
          controller: last,
          decoration: const InputDecoration(
            labelText: 'Фамилия (при регистрации)',
          ),
        ),
        TextField(
          controller: referral,
          textCapitalization: TextCapitalization.characters,
          decoration: const InputDecoration(
            labelText: 'Referral code (необязательно)',
          ),
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: () async {
            try {
              final api = ref.read(apiProvider);
              await api.call(
                'POST',
                '/auth/otp/request',
                authenticated: false,
                body: {'phone': phone.text, 'deviceId': await api.deviceId()},
              );
              setState(() => message = 'Код отправлен');
            } catch (error) {
              setState(() => message = '$error');
            }
          },
          child: const Text('Получить код'),
        ),
        TextField(
          controller: code,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Код из SMS'),
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: () => ref
              .read(authProvider.notifier)
              .verify(
                phone.text,
                code.text,
                first.text,
                last.text,
                referral.text,
              ),
          child: const Text('Продолжить'),
        ),
        if (message != null || widget.initialError != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(
              message ?? widget.initialError!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
      ],
    ),
  );
}

class HouseholdScreen extends ConsumerStatefulWidget {
  const HouseholdScreen({super.key});
  @override
  ConsumerState<HouseholdScreen> createState() => _HouseholdScreenState();
}

class _HouseholdScreenState extends ConsumerState<HouseholdScreen> {
  Map<String, dynamic>? household;
  String? error;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final value = await ref.read(apiProvider).call('GET', '/household');
      if (mounted) {
        setState(() {
          household = value;
          error = null;
        });
      }
    } catch (caught) {
      if (mounted) setState(() => error = '$caught');
    }
  }

  @override
  Widget build(BuildContext context) {
    final members = household?['members'] as List<dynamic>? ?? [];
    return Scaffold(
      appBar: AppBar(
        title: const Text('Моя семья'),
        actions: [
          IconButton(
            tooltip: 'JANTOK CLUB',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ClubScreen()),
            ),
            icon: const Icon(Icons.workspace_premium),
          ),
          IconButton(
            tooltip: 'Меню и подписка',
            onPressed: household == null
                ? null
                : () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) =>
                          SubscriptionMenuScreen(household: household!),
                    ),
                  ),
            icon: const Icon(Icons.restaurant_menu),
          ),
          IconButton(
            onPressed: () => ref.read(authProvider.notifier).logout(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => const AddMemberScreen()),
          );
          await load();
        },
        icon: const Icon(Icons.person_add),
        label: const Text('Добавить'),
      ),
      body: household == null
          ? Center(
              child: error == null
                  ? const CircularProgressIndicator()
                  : Text(error!),
            )
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(
                  'Этап: ${household!['onboardingStep']}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 12),
                ...members.map((raw) {
                  final member = raw as Map<String, dynamic>;
                  return Card(
                    child: ListTile(
                      title: Text('${member['firstName']}'),
                      subtitle: Text('${member['birthDate']}'.split('T').first),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () async {
                        await Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => QuestionnaireScreen(
                              memberId: member['id'] as String,
                            ),
                          ),
                        );
                        await load();
                      },
                    ),
                  );
                }),
                const SizedBox(height: 16),
                FilledButton.tonal(
                  onPressed: () async {
                    await Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const AddressScreen()),
                    );
                    await load();
                  },
                  child: const Text('Адрес и окно доставки'),
                ),
              ],
            ),
    );
  }
}

class ClubScreen extends ConsumerStatefulWidget {
  const ClubScreen({super.key});

  @override
  ConsumerState<ClubScreen> createState() => _ClubScreenState();
}

class _ClubScreenState extends ConsumerState<ClubScreen> {
  Map<String, dynamic>? dashboard;
  Map<String, dynamic>? runtimeConfig;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final api = ref.read(apiProvider);
      final values = await Future.wait([
        api.call('GET', '/loyalty/club'),
        api.call('GET', '/config/runtime', authenticated: false),
      ]);
      if (mounted) {
        setState(() {
          dashboard = values[0];
          runtimeConfig = values[1];
          error = null;
        });
      }
    } catch (caught) {
      if (mounted) setState(() => error = '$caught');
    }
  }

  @override
  Widget build(BuildContext context) {
    final wallet = dashboard?['wallet'] as Map<String, dynamic>?;
    final membership = dashboard?['membership'] as Map<String, dynamic>?;
    final tier = membership?['tier'] as Map<String, dynamic>?;
    final nextTier = dashboard?['nextTier'] as Map<String, dynamic>?;
    final history = dashboard?['history'] as List<dynamic>? ?? [];
    final friends = dashboard?['invitedFriends'] as List<dynamic>? ?? [];
    final cycles = membership?['qualifyingPaidCycles'] ?? 0;
    final effective = runtimeConfig?['effective'] as Map<String, dynamic>?;
    final cutoff = effective?['cutoff'] as Map<String, dynamic>?;
    final configuredLevels = effective?['club'] as List<dynamic>? ?? [];
    final cycleDays = cutoff?['serviceDaysPerCycle'] ?? 30;
    return Scaffold(
      appBar: AppBar(title: const Text('JANTOK CLUB')),
      body: dashboard == null
          ? Center(
              child: error == null
                  ? const CircularProgressIndicator()
                  : Text(error!),
            )
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    tier?['nameRu']?.toString() ?? 'Уровень ещё не открыт',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  Text('$cycles оплаченных циклов по $cycleDays service days'),
                  Text(
                    'Действующих уровней: ${configuredLevels.length} · конфигурация v${runtimeConfig?['revision'] ?? 0}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  if (nextTier != null)
                    LinearProgressIndicator(
                      value:
                          (cycles as num) /
                          (nextTier['thresholdPaidCycles'] as num),
                    ),
                  const SizedBox(height: 20),
                  Card(
                    child: ListTile(
                      title: Text('${wallet?['availableKzt'] ?? 0} бонусов'),
                      subtitle: Text(
                        'Зарезервировано: ${wallet?['reservedKzt'] ?? 0} · 1 бонус = 1 ₸ · бессрочно',
                      ),
                    ),
                  ),
                  SelectableText(
                    'Мой referral code: ${dashboard?['referralCode'] ?? '—'}',
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'Приглашённые друзья',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  if (friends.isEmpty) const Text('Пока нет квалификаций'),
                  ...friends.map(
                    (raw) => ListTile(
                      leading: const Icon(Icons.person_outline),
                      title: Text('${raw['displayName']}'),
                      subtitle: Text('${raw['status']}'),
                    ),
                  ),
                  const Divider(height: 32),
                  Text(
                    'История бонусов',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  ...history.map(
                    (raw) => ListTile(
                      dense: true,
                      title: Text('${raw['reason']}'),
                      subtitle: Text('${raw['type']}'),
                      trailing: Text('${raw['amountKzt']}'),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class SubscriptionMenuScreen extends ConsumerStatefulWidget {
  const SubscriptionMenuScreen({super.key, required this.household});
  final Map<String, dynamic> household;

  @override
  ConsumerState<SubscriptionMenuScreen> createState() =>
      _SubscriptionMenuScreenState();
}

class _SubscriptionMenuScreenState
    extends ConsumerState<SubscriptionMenuScreen> {
  Map<String, dynamic>? menu, subscription, quote, runtimeConfig;
  String? message;

  String get startDate => DateTime.now()
      .toUtc()
      .add(const Duration(days: 2))
      .toIso8601String()
      .split('T')
      .first;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final api = ref.read(apiProvider);
      final values = await Future.wait([
        api.call('GET', '/menu?from=$startDate'),
        api.call('GET', '/subscriptions/current'),
        api.call('GET', '/config/runtime', authenticated: false),
      ]);
      if (mounted) {
        setState(() {
          menu = values[0];
          subscription = values[1].isEmpty ? null : values[1];
          runtimeConfig = values[2];
          message = null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => message = '$error');
    }
  }

  Future<void> calculateQuote() async {
    final members = widget.household['members'] as List<dynamic>? ?? [];
    final addresses = widget.household['addresses'] as List<dynamic>? ?? [];
    if (members.isEmpty || addresses.isEmpty) {
      setState(() => message = 'Добавьте члена семьи и адрес доставки.');
      return;
    }
    try {
      final result = await ref
          .read(apiProvider)
          .call(
            'POST',
            '/subscriptions/quotes',
            body: {
              'addressId': addresses.first['id'],
              'startDate': startDate,
              'memberIds': members.map((item) => item['id']).toList(),
              'bonusKzt': 0,
              'guestDays': 0,
            },
          );
      if (mounted) setState(() => quote = result);
    } catch (error) {
      if (mounted) setState(() => message = '$error');
    }
  }

  Future<void> checkout() async {
    if (quote == null) return;
    try {
      await ref
          .read(apiProvider)
          .call(
            'POST',
            '/subscriptions/checkout',
            body: {
              'quoteId': quote!['id'],
              'idempotencyKey':
                  'mobile-${quote!['id']}-${DateTime.now().millisecondsSinceEpoch}',
              'autoRenew': false,
            },
          );
      quote = null;
      await load();
    } catch (error) {
      if (mounted) setState(() => message = '$error');
    }
  }

  @override
  Widget build(BuildContext context) {
    final days = menu?['days'] as List<dynamic>? ?? [];
    final serviceDays = subscription?['serviceDays'] as List<dynamic>? ?? [];
    final effective = runtimeConfig?['effective'] as Map<String, dynamic>?;
    final cutoff = effective?['cutoff'] as Map<String, dynamic>?;
    final pricing = effective?['pricing'] as Map<String, dynamic>?;
    final cycleDays = cutoff?['serviceDaysPerCycle'] ?? 30;
    return Scaffold(
      appBar: AppBar(title: const Text('Меню и подписка')),
      body: RefreshIndicator(
        onRefresh: load,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (subscription == null) ...[
              Text(
                'Подписка на $cycleDays service days',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const Text(
                'Сервер рассчитает каждый пункт и зафиксирует цену после оплаты.',
              ),
              Text(
                'Базовая взрослая цена: ${pricing?['adultMonthlyKzt'] ?? '—'} ₸ · menu cut-off: ${cutoff?['menuMinutes'] ?? '—'} минут от начала предыдущего дня',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              FilledButton.tonal(
                onPressed: calculateQuote,
                child: const Text('Рассчитать стоимость'),
              ),
              if (quote != null) ...[
                ...((quote!['lines'] as List<dynamic>).map(
                  (line) => ListTile(
                    dense: true,
                    title: Text('${line['description']}'),
                    trailing: Text('${line['totalKzt']} ₸'),
                  ),
                )),
                Text('К оплате: ${quote!['cashKzt']} ₸'),
                FilledButton(
                  onPressed: checkout,
                  child: const Text('Оплатить и начать'),
                ),
              ],
            ] else ...[
              Text(
                'Статус: ${subscription!['status']}',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Text(
                'Запланировано: ${serviceDays.where((day) => day['status'] == 'PLANNED').length} дней · до ${subscription!['currentEndDate'].toString().split('T').first}',
              ),
              const SizedBox(height: 12),
              ...serviceDays
                  .where((day) => day['dailyFulfillment'] != null)
                  .take(7)
                  .map((rawDay) {
                    final day = rawDay as Map<String, dynamic>;
                    final fulfillment =
                        day['dailyFulfillment'] as Map<String, dynamic>;
                    return Card(
                      child: ListTile(
                        leading: const Icon(Icons.local_shipping_outlined),
                        title: Text(
                          day['serviceDate'].toString().split('T').first,
                        ),
                        subtitle: Text('${fulfillment['status']}'),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => DeliveryTrackingScreen(
                              fulfillmentId: fulfillment['id'] as String,
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
            ],
            const Divider(height: 36),
            Text(
              'Меню на 7 дней',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            if (menu == null) const LinearProgressIndicator(),
            ...days.map((rawDay) {
              final day = rawDay as Map<String, dynamic>;
              final options = day['options'] as List<dynamic>;
              return Card(
                child: ExpansionTile(
                  title: Text('${day['serviceDate']}'),
                  subtitle: Text('${day['serviceDayStatus'] ?? 'вне цикла'}'),
                  children: options.map((rawOption) {
                    final option = rawOption as Map<String, dynamic>;
                    final meal = option['meal'] as Map<String, dynamic>;
                    final translations = meal['translations'] as List<dynamic>;
                    final ru = translations.cast<Map<String, dynamic>>().where(
                      (item) => item['locale'] == 'ru',
                    );
                    final safety = option['memberSafety'] as List<dynamic>;
                    return ListTile(
                      title: Text(
                        ru.isEmpty ? '${meal['code']}' : '${ru.first['name']}',
                      ),
                      subtitle: Text(
                        '${option['mealType']} · ${meal['caloriesKcal']} ккал · ${meal['servingWeightGrams']} г',
                      ),
                      trailing: Icon(
                        safety.every((item) => item['safe'] == true)
                            ? Icons.verified_user
                            : Icons.warning_amber,
                      ),
                    );
                  }).toList(),
                ),
              );
            }),
            if (message != null)
              Text(message!, style: const TextStyle(color: Colors.red)),
          ],
        ),
      ),
    );
  }
}

class DeliveryTrackingScreen extends ConsumerStatefulWidget {
  const DeliveryTrackingScreen({super.key, required this.fulfillmentId});
  final String fulfillmentId;

  @override
  ConsumerState<DeliveryTrackingScreen> createState() =>
      _DeliveryTrackingScreenState();
}

class _DeliveryTrackingScreenState
    extends ConsumerState<DeliveryTrackingScreen> {
  Map<String, dynamic>? delivery;
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final value = await ref
          .read(apiProvider)
          .call(
            'GET',
            '/deliveries/daily-orders/${widget.fulfillmentId}/tracking',
          );
      if (mounted) setState(() => delivery = value);
    } catch (caught) {
      if (mounted) setState(() => error = '$caught');
    }
  }

  Future<void> openExternal(Uri uri) async {
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) &&
        mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Не удалось открыть')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final courier = delivery?['courier'] as Map<String, dynamic>?;
    final tracking = delivery?['tracking'] as Map<String, dynamic>?;
    final eta = delivery?['eta'] as Map<String, dynamic>?;
    final phone = courier?['phone']?.toString();
    final trackingUrl = tracking?['url']?.toString();
    final hasCoordinates =
        tracking?['latitude'] != null && tracking?['longitude'] != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Доставка сегодня')),
      body: delivery == null
          ? Center(
              child: error == null
                  ? const CircularProgressIndicator()
                  : Text(error!),
            )
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    '${delivery!['status']}',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  Text('Финансовый статус: ${delivery!['financialStatus']}'),
                  const SizedBox(height: 20),
                  Container(
                    height: 180,
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surfaceContainer,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Center(
                      child: hasCoordinates
                          ? Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.location_pin, size: 42),
                                Text(
                                  '${tracking!['latitude']}, ${tracking['longitude']}',
                                ),
                                const Text('Последняя точка провайдера'),
                              ],
                            )
                          : const Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.map_outlined, size: 42),
                                Text(
                                  'Live-карта пока недоступна.\nФиктивная точка не показывается.',
                                  textAlign: TextAlign.center,
                                ),
                              ],
                            ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  ListTile(
                    leading: const Icon(Icons.schedule),
                    title: const Text('Ожидаемое время'),
                    subtitle: Text(
                      eta?['eta']?.toString() ??
                          'ETA временно недоступен — ${delivery!['fallback']}',
                    ),
                  ),
                  if (trackingUrl != null)
                    FilledButton.tonalIcon(
                      onPressed: () => openExternal(Uri.parse(trackingUrl)),
                      icon: const Icon(Icons.open_in_new),
                      label: const Text('Открыть трекинг провайдера'),
                    ),
                  if (phone != null)
                    FilledButton.icon(
                      onPressed: () =>
                          openExternal(Uri(scheme: 'tel', path: phone)),
                      icon: const Icon(Icons.phone),
                      label: const Text('Позвонить курьеру'),
                    ),
                  if (phone == null)
                    const ListTile(
                      leading: Icon(Icons.support_agent),
                      title: Text('Телефон курьера пока недоступен'),
                      subtitle: Text(
                        'При NO_ANSWER или DELIVERY_FAILED обратитесь в поддержку.',
                      ),
                    ),
                  const Text('Чата с курьером в приложении нет.'),
                ],
              ),
            ),
    );
  }
}

class AddMemberScreen extends ConsumerStatefulWidget {
  const AddMemberScreen({super.key});
  @override
  ConsumerState<AddMemberScreen> createState() => _AddMemberState();
}

class _AddMemberState extends ConsumerState<AddMemberScreen> {
  final name = TextEditingController(),
      birth = TextEditingController(text: '1990-01-01');
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Член семьи')),
    body: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        children: [
          TextField(
            controller: name,
            decoration: const InputDecoration(labelText: 'Имя'),
          ),
          TextField(
            controller: birth,
            decoration: const InputDecoration(
              labelText: 'Дата рождения YYYY-MM-DD',
            ),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () async {
              await ref
                  .read(apiProvider)
                  .call(
                    'POST',
                    '/household/members',
                    body: {'firstName': name.text, 'birthDate': birth.text},
                  );
              if (context.mounted) Navigator.pop(context);
            },
            child: const Text('Сохранить'),
          ),
        ],
      ),
    ),
  );
}

class QuestionnaireScreen extends ConsumerStatefulWidget {
  const QuestionnaireScreen({super.key, required this.memberId});
  final String memberId;
  @override
  ConsumerState<QuestionnaireScreen> createState() => _QuestionnaireState();
}

class _QuestionnaireState extends ConsumerState<QuestionnaireScreen> {
  Map<String, dynamic>? catalogs;
  final height = TextEditingController(text: '170');
  final weight = TextEditingController(text: '70');
  final sportHours = TextEditingController(text: '0');
  final freeAllergy = TextEditingController();
  final notes = TextEditingController();
  String biologicalSex = 'UNSPECIFIED';
  String sportIntensity = 'NONE';
  String goal = 'MAINTAIN';
  String portion = 'RECOMMENDED';
  String preferenceKind = 'PREFERRED';
  String? activityId, dietId, sportTypeId, allergenId, preferenceIngredientId;
  @override
  void initState() {
    super.initState();
    ref.read(apiProvider).call('GET', '/catalogs/questionnaire').then((value) {
      if (mounted) {
        setState(() {
          catalogs = value;
          activityId = (value['activityLevels'] as List).first['id'] as String;
          dietId = (value['dietTypes'] as List).first['id'] as String;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (catalogs == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final activities = catalogs!['activityLevels'] as List,
        diets = catalogs!['dietTypes'] as List,
        allergens = catalogs!['allergens'] as List,
        sports = catalogs!['sportTypes'] as List,
        ingredients = catalogs!['ingredients'] as List;
    return Scaffold(
      appBar: AppBar(title: const Text('Анкета')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Все расчёты и проверка безопасности выполняются сервером. Свободный текст аллергии потребует ручной проверки.',
          ),
          DropdownButtonFormField<String>(
            initialValue: biologicalSex,
            decoration: const InputDecoration(labelText: 'Пол'),
            items: const [
              DropdownMenuItem(value: 'FEMALE', child: Text('Женский')),
              DropdownMenuItem(value: 'MALE', child: Text('Мужской')),
              DropdownMenuItem(
                value: 'UNSPECIFIED',
                child: Text('Не указывать'),
              ),
            ],
            onChanged: (value) => setState(() => biologicalSex = value!),
          ),
          TextField(
            controller: height,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Рост, см'),
          ),
          TextField(
            controller: weight,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Вес, кг'),
          ),
          DropdownButtonFormField<String>(
            initialValue: activityId,
            decoration: const InputDecoration(labelText: 'Активность'),
            items: activities
                .map(
                  (item) => DropdownMenuItem(
                    value: item['id'] as String,
                    child: Text(item['nameRu'] as String),
                  ),
                )
                .toList(),
            onChanged: (value) => setState(() => activityId = value),
          ),
          DropdownButtonFormField<String>(
            initialValue: sportIntensity,
            decoration: const InputDecoration(
              labelText: 'Интенсивность спорта',
            ),
            items: const [
              DropdownMenuItem(value: 'NONE', child: Text('Нет')),
              DropdownMenuItem(value: 'LIGHT', child: Text('Лёгкая')),
              DropdownMenuItem(value: 'MODERATE', child: Text('Средняя')),
              DropdownMenuItem(value: 'HIGH', child: Text('Высокая')),
            ],
            onChanged: (value) => setState(() => sportIntensity = value!),
          ),
          TextField(
            controller: sportHours,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Спорт, часов в неделю',
            ),
          ),
          DropdownButtonFormField<String?>(
            initialValue: sportTypeId,
            decoration: const InputDecoration(
              labelText: 'Вид спорта (необязательно)',
            ),
            items: [
              const DropdownMenuItem(value: null, child: Text('Не выбран')),
              ...sports.map(
                (item) => DropdownMenuItem(
                  value: item['id'] as String,
                  child: Text(item['nameRu'] as String),
                ),
              ),
            ],
            onChanged: (value) => setState(() => sportTypeId = value),
          ),
          DropdownButtonFormField<String>(
            initialValue: goal,
            decoration: const InputDecoration(labelText: 'Цель'),
            items: const [
              DropdownMenuItem(
                value: 'LOSE_WEIGHT',
                child: Text('Снижение веса'),
              ),
              DropdownMenuItem(value: 'MAINTAIN', child: Text('Поддержание')),
              DropdownMenuItem(value: 'GAIN_WEIGHT', child: Text('Набор веса')),
              DropdownMenuItem(value: 'SPORT', child: Text('Спортивная цель')),
            ],
            onChanged: (value) => setState(() => goal = value!),
          ),
          DropdownButtonFormField<String>(
            initialValue: dietId,
            decoration: const InputDecoration(labelText: 'Тип питания'),
            items: diets
                .map(
                  (item) => DropdownMenuItem(
                    value: item['id'] as String,
                    child: Text(item['nameRu'] as String),
                  ),
                )
                .toList(),
            onChanged: (value) => setState(() => dietId = value),
          ),
          DropdownButtonFormField<String>(
            initialValue: portion,
            decoration: const InputDecoration(labelText: 'Порция'),
            items: const [
              DropdownMenuItem(
                value: 'RECOMMENDED',
                child: Text('Рекомендованная'),
              ),
              DropdownMenuItem(value: 'SMALL', child: Text('Маленькая')),
              DropdownMenuItem(value: 'STANDARD', child: Text('Стандартная')),
              DropdownMenuItem(value: 'LARGE', child: Text('Большая')),
            ],
            onChanged: (value) => setState(() => portion = value!),
          ),
          DropdownButtonFormField<String?>(
            initialValue: allergenId,
            decoration: const InputDecoration(labelText: 'Аллергия'),
            items: [
              const DropdownMenuItem(value: null, child: Text('Нет аллергий')),
              ...allergens.map(
                (item) => DropdownMenuItem(
                  value: item['id'] as String,
                  child: Text(item['nameRu'] as String),
                ),
              ),
            ],
            onChanged: (value) => setState(() {
              allergenId = value;
              if (value != null) freeAllergy.clear();
            }),
          ),
          TextField(
            controller: freeAllergy,
            onChanged: (value) {
              if (value.trim().isNotEmpty) setState(() => allergenId = null);
            },
            decoration: const InputDecoration(
              labelText: 'Другая аллергия — свободный текст',
            ),
          ),
          DropdownButtonFormField<String?>(
            initialValue: preferenceIngredientId,
            decoration: const InputDecoration(
              labelText: 'Предпочтение/нелюбимый продукт',
            ),
            items: [
              const DropdownMenuItem(value: null, child: Text('Не выбран')),
              ...ingredients.map(
                (item) => DropdownMenuItem(
                  value: item['id'] as String,
                  child: Text(item['nameRu'] as String),
                ),
              ),
            ],
            onChanged: (value) =>
                setState(() => preferenceIngredientId = value),
          ),
          if (preferenceIngredientId != null)
            DropdownButtonFormField<String>(
              initialValue: preferenceKind,
              decoration: const InputDecoration(
                labelText: 'Отношение к продукту',
              ),
              items: const [
                DropdownMenuItem(value: 'PREFERRED', child: Text('Люблю')),
                DropdownMenuItem(value: 'DISLIKED', child: Text('Не люблю')),
              ],
              onChanged: (value) => setState(() => preferenceKind = value!),
            ),
          TextField(
            controller: notes,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Примечания'),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () async {
              await ref
                  .read(apiProvider)
                  .call(
                    'PUT',
                    '/household/members/${widget.memberId}/questionnaire',
                    body: {
                      'biologicalSex': biologicalSex,
                      'heightCm': double.parse(height.text),
                      'weightKg': double.parse(weight.text),
                      'activityLevelId': activityId,
                      'sportIntensity': sportIntensity,
                      'sportHoursPerWeek': double.parse(sportHours.text),
                      'goal': goal,
                      'dietTypeId': dietId,
                      'allergyDeclarationStatus':
                          allergenId == null && freeAllergy.text.trim().isEmpty
                          ? 'NONE'
                          : 'DECLARED',
                      'portionPreference': portion,
                      'sportTypeIds': sportTypeId == null ? [] : [sportTypeId],
                      'allergies': allergenId != null
                          ? [
                              {'allergenId': allergenId},
                            ]
                          : freeAllergy.text.trim().isNotEmpty
                          ? [
                              {'freeText': freeAllergy.text.trim()},
                            ]
                          : [],
                      'preferences': preferenceIngredientId == null
                          ? []
                          : [
                              {
                                'ingredientId': preferenceIngredientId,
                                'kind': preferenceKind,
                              },
                            ],
                      'notes': notes.text.trim().isEmpty
                          ? null
                          : notes.text.trim(),
                    },
                  );
              if (context.mounted) Navigator.pop(context);
            },
            child: const Text('Сохранить анкету'),
          ),
        ],
      ),
    );
  }
}

class AddressScreen extends ConsumerStatefulWidget {
  const AddressScreen({super.key});
  @override
  ConsumerState<AddressScreen> createState() => _AddressState();
}

class _AddressState extends ConsumerState<AddressScreen> {
  final label = TextEditingController(text: 'Дом'),
      street = TextEditingController(),
      entrance = TextEditingController(),
      floor = TextEditingController(),
      apartment = TextEditingController(),
      intercom = TextEditingController(),
      landmarks = TextEditingController(),
      latitude = TextEditingController(),
      longitude = TextEditingController();
  Map<String, dynamic>? config, household;
  String? slotId, error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final values = await Future.wait([
        ref.read(apiProvider).call('GET', '/deliveries/config'),
        ref.read(apiProvider).call('GET', '/household'),
      ]);
      final slots = values[0]['slots'] as List<dynamic>;
      if (mounted) {
        setState(() {
          config = values[0];
          household = values[1];
          slotId ??= slots.isEmpty ? null : slots.first['id'] as String;
          if (config!['zoneMode'] == 'DEMO') {
            latitude.text = '51.1282';
            longitude.text = '71.4304';
          }
        });
      }
    } catch (caught) {
      if (mounted) setState(() => error = '$caught');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Доставка в Астане')),
    body: config == null
        ? Center(
            child: error == null
                ? const CircularProgressIndicator()
                : Text(error!),
          )
        : ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                'Сохранено ${(household?['addresses'] as List<dynamic>? ?? []).length} из ${config!['maxSavedAddresses']}. ${config!['zoneMode'] == 'DEMO' ? 'Используется demo zone.' : 'Адрес проверяется по согласованной зоне.'}',
              ),
              const Text(
                'Геолокация телефона не нужна: введите адрес и координаты выбранной точки вручную.',
              ),
              TextField(
                controller: label,
                decoration: const InputDecoration(
                  labelText: 'Название (Дом, Работа)',
                ),
              ),
              TextField(
                controller: street,
                decoration: const InputDecoration(labelText: 'Улица и дом'),
              ),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: entrance,
                      decoration: const InputDecoration(labelText: 'Подъезд'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: floor,
                      decoration: const InputDecoration(labelText: 'Этаж'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: apartment,
                      decoration: const InputDecoration(
                        labelText: 'Квартира/офис',
                      ),
                    ),
                  ),
                ],
              ),
              TextField(
                controller: intercom,
                decoration: const InputDecoration(labelText: 'Домофон'),
              ),
              TextField(
                controller: landmarks,
                decoration: const InputDecoration(labelText: 'Ориентиры'),
              ),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: latitude,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                        signed: true,
                      ),
                      decoration: const InputDecoration(labelText: 'Широта'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: longitude,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                        signed: true,
                      ),
                      decoration: const InputDecoration(labelText: 'Долгота'),
                    ),
                  ),
                ],
              ),
              DropdownButtonFormField<String>(
                initialValue: slotId,
                decoration: const InputDecoration(labelText: 'Бесплатный слот'),
                items: (config!['slots'] as List<dynamic>)
                    .map(
                      (slot) => DropdownMenuItem(
                        value: slot['id'] as String,
                        child: Text('${slot['name']} · бесплатно'),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() => slotId = value),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () async {
                  await ref
                      .read(apiProvider)
                      .call(
                        'POST',
                        '/household/addresses',
                        body: {
                          'label': label.text,
                          'streetAddress': street.text,
                          'entrance': entrance.text.isEmpty
                              ? null
                              : entrance.text,
                          'floor': floor.text.isEmpty ? null : floor.text,
                          'apartment': apartment.text.isEmpty
                              ? null
                              : apartment.text,
                          'intercom': intercom.text.isEmpty
                              ? null
                              : intercom.text,
                          'landmarks': landmarks.text.isEmpty
                              ? null
                              : landmarks.text,
                          'latitude': double.parse(latitude.text),
                          'longitude': double.parse(longitude.text),
                          'deliverySlotId': slotId,
                          'isDefault': true,
                        },
                      );
                  if (context.mounted) Navigator.pop(context);
                },
                child: const Text('Сохранить'),
              ),
            ],
          ),
  );
}
