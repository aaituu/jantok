import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:image_picker/image_picker.dart';
import 'package:jantok/l10n/app_localizations.dart';
import 'package:url_launcher/url_launcher.dart';

import 'app.dart' as legacy;
import 'design_system.dart';

final localeProvider = AsyncNotifierProvider<LocaleController, Locale>(
  LocaleController.new,
);
final onboardingProvider = AsyncNotifierProvider<OnboardingController, bool>(
  OnboardingController.new,
);

class LocaleController extends AsyncNotifier<Locale> {
  @override
  Future<Locale> build() async {
    final code = await ref.read(legacy.storageProvider).read(key: 'locale');
    return Locale(code == 'ru' || code == 'en' ? code! : 'kk');
  }

  Future<void> select(String code) async {
    await ref.read(legacy.storageProvider).write(key: 'locale', value: code);
    state = AsyncData(Locale(code));
  }
}

class OnboardingController extends AsyncNotifier<bool> {
  @override
  Future<bool> build() async =>
      await ref.read(legacy.storageProvider).read(key: 'onboarding_complete') ==
      'true';

  Future<void> complete() async {
    await ref
        .read(legacy.storageProvider)
        .write(key: 'onboarding_complete', value: 'true');
    state = const AsyncData(true);
  }
}

class JantokApp extends ConsumerWidget {
  const JantokApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = ref.watch(localeProvider).value ?? const Locale('kk');
    return MaterialApp(
      title: 'JANTOK',
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
      home: const StartupGate(),
    );
  }
}

class StartupGate extends ConsumerWidget {
  const StartupGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final onboarding = ref.watch(onboardingProvider);
    final auth = ref.watch(legacy.authProvider);
    if (onboarding.isLoading || auth.isLoading) {
      return const SplashScreen();
    }
    if (onboarding.value != true) return const OnboardingScreen();
    return auth.when(
      data: (signedIn) => signedIn ? const MainShell() : const LoginScreen(),
      loading: () => const SplashScreen(),
      error: (error, _) => LoginScreen(initialError: '$error'),
    );
  }
}

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(
    body: SafeArea(
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            JantokWordmark(),
            SizedBox(height: JantokSpace.lg),
            CircularProgressIndicator(),
          ],
        ),
      ),
    ),
  );
}

class OnboardingScreen extends ConsumerWidget {
  const OnboardingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(JantokSpace.lg),
          children: [
            const SizedBox(height: JantokSpace.xl),
            const JantokWordmark(),
            const SizedBox(height: JantokSpace.xl),
            Icon(
              Icons.family_restroom,
              size: 88,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(height: JantokSpace.lg),
            Text(
              l.onboardingTitle,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: JantokSpace.md),
            Text(
              l.onboardingBody,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const SizedBox(height: JantokSpace.md),
            Text(l.onboardingPrivacy),
            const SizedBox(height: JantokSpace.xl),
            const LanguagePicker(),
            const SizedBox(height: JantokSpace.lg),
            FilledButton(
              onPressed: () => ref.read(onboardingProvider.notifier).complete(),
              child: Text(l.continueAction),
            ),
            const SizedBox(height: JantokSpace.sm),
            Text(
              l.brandAssetsMissing,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class LanguagePicker extends ConsumerWidget {
  const LanguagePicker({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final selected = Localizations.localeOf(context).languageCode;
    return Semantics(
      label: l.language,
      child: SegmentedButton<String>(
        segments: [
          ButtonSegment(value: 'kk', label: Text(l.kazakh)),
          ButtonSegment(value: 'ru', label: Text(l.russian)),
          ButtonSegment(value: 'en', label: Text(l.english)),
        ],
        selected: {selected},
        onSelectionChanged: (value) =>
            ref.read(localeProvider.notifier).select(value.first),
      ),
    );
  }
}

class CompactLanguagePicker extends ConsumerWidget {
  const CompactLanguagePicker({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final selected = Localizations.localeOf(context).languageCode;
    final labels = {'kk': l.kazakh, 'ru': l.russian, 'en': l.english};
    return PopupMenuButton<String>(
      tooltip: l.language,
      icon: const Icon(Icons.language),
      initialValue: selected,
      onSelected: (value) => ref.read(localeProvider.notifier).select(value),
      itemBuilder: (_) => labels.entries
          .map(
            (entry) => PopupMenuItem<String>(
              value: entry.key,
              child: Row(
                children: [
                  if (entry.key == selected) ...[
                    const Icon(Icons.check, size: 18),
                    const SizedBox(width: JantokSpace.sm),
                  ],
                  Flexible(child: Text(entry.value)),
                ],
              ),
            ),
          )
          .toList(),
    );
  }
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key, this.initialError});
  final String? initialError;
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final phone = TextEditingController();
  final code = TextEditingController();
  final first = TextEditingController();
  final last = TextEditingController();
  final referral = TextEditingController();
  bool codeRequested = false;
  bool sending = false;
  String? message;

  Future<void> request({bool resend = false}) async {
    setState(() => sending = true);
    try {
      final api = ref.read(legacy.apiProvider);
      await api.call(
        'POST',
        resend ? '/auth/otp/resend' : '/auth/otp/request',
        authenticated: false,
        body: {'phone': phone.text.trim(), 'deviceId': await api.deviceId()},
      );
      if (mounted) setState(() => codeRequested = true);
    } catch (error) {
      if (mounted) setState(() => message = '$error');
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final auth = ref.watch(legacy.authProvider);
    return Scaffold(
      appBar: AppBar(
        actions: const [
          Padding(
            padding: EdgeInsets.symmetric(horizontal: JantokSpace.sm),
            child: CompactLanguagePicker(),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: ListView(
              padding: const EdgeInsets.all(JantokSpace.lg),
              children: [
                const JantokWordmark(),
                const SizedBox(height: JantokSpace.xl),
                Text(
                  l.loginTitle,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: JantokSpace.lg),
                TextField(
                  controller: phone,
                  keyboardType: TextInputType.phone,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  decoration: InputDecoration(
                    labelText: l.phone,
                    hintText: '+7…',
                  ),
                ),
                if (!codeRequested) ...[
                  const SizedBox(height: JantokSpace.sm),
                  TextField(
                    controller: first,
                    decoration: InputDecoration(labelText: l.firstName),
                  ),
                  const SizedBox(height: JantokSpace.sm),
                  TextField(
                    controller: last,
                    decoration: InputDecoration(labelText: l.lastName),
                  ),
                  const SizedBox(height: JantokSpace.sm),
                  TextField(
                    controller: referral,
                    decoration: InputDecoration(labelText: l.referral),
                  ),
                ],
                const SizedBox(height: JantokSpace.md),
                FilledButton.tonal(
                  onPressed: sending
                      ? null
                      : () => request(resend: codeRequested),
                  child: Text(codeRequested ? l.resendCode : l.sendCode),
                ),
                if (codeRequested) ...[
                  const SizedBox(height: JantokSpace.md),
                  TextField(
                    controller: code,
                    keyboardType: TextInputType.number,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    decoration: InputDecoration(
                      labelText: l.otp,
                      helperText: l.codeSent,
                    ),
                  ),
                  const SizedBox(height: JantokSpace.md),
                  FilledButton(
                    onPressed: auth.isLoading
                        ? null
                        : () => ref
                              .read(legacy.authProvider.notifier)
                              .verify(
                                phone.text,
                                code.text,
                                first.text,
                                last.text,
                                referral.text,
                              ),
                    child: Text(l.continueAction),
                  ),
                ],
                if (message != null || widget.initialError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: JantokSpace.md),
                    child: Text(
                      message ?? widget.initialError!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class MainShell extends StatefulWidget {
  const MainShell({super.key});
  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int index = 0;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final pages = const [
      HomeScreen(),
      MenuScreen(),
      DeliveryScreen(),
      ClubDashboardScreen(),
      ProfileScreen(),
    ];
    return Scaffold(
      body: IndexedStack(index: index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.home_outlined),
            selectedIcon: const Icon(Icons.home),
            label: l.home,
          ),
          NavigationDestination(
            icon: const Icon(Icons.restaurant_menu_outlined),
            selectedIcon: const Icon(Icons.restaurant_menu),
            label: l.menu,
          ),
          NavigationDestination(
            icon: const Icon(Icons.local_shipping_outlined),
            selectedIcon: const Icon(Icons.local_shipping),
            label: l.delivery,
          ),
          NavigationDestination(
            icon: const Icon(Icons.workspace_premium_outlined),
            selectedIcon: const Icon(Icons.workspace_premium),
            label: l.club,
          ),
          NavigationDestination(
            icon: const Icon(Icons.person_outline),
            selectedIcon: const Icon(Icons.person),
            label: l.profile,
          ),
        ],
      ),
    );
  }
}

abstract class ApiPageState<T extends ConsumerStatefulWidget>
    extends ConsumerState<T> {
  bool loading = true;
  Object? error;
  Future<void> load();
  void beginLoad() => setState(() {
    loading = true;
    error = null;
  });
  void fail(Object value) {
    if (mounted) {
      setState(() {
        loading = false;
        error = value;
      });
    }
  }
}

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});
  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ApiPageState<HomeScreen> {
  Map<String, dynamic>? household;
  Map<String, dynamic>? subscription;
  Map<String, dynamic>? menu;

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    if (!loading) beginLoad();
    try {
      final api = ref.read(legacy.apiProvider);
      final values = await Future.wait([
        api.call('GET', '/household'),
        api.call('GET', '/subscriptions/current'),
        api.call('GET', '/menu'),
      ]);
      if (mounted) {
        setState(() {
          household = values[0];
          subscription = values[1].isEmpty ? null : values[1];
          menu = values[2];
          loading = false;
        });
      }
    } catch (caught) {
      fail(caught);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final members = household?['members'] as List<dynamic>? ?? [];
    final days = menu?['days'] as List<dynamic>? ?? [];
    final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
    final todayDay = days
        .cast<Map<String, dynamic>>()
        .where((d) => d['serviceDate'] == today)
        .firstOrNull;
    final planned = (subscription?['serviceDays'] as List<dynamic>? ?? [])
        .where((d) => d['status'] == 'PLANNED')
        .length;
    return SafeArea(
      child: AsyncStateView(
        loading: loading,
        error: error,
        onRetry: load,
        child: RefreshIndicator(
          onRefresh: load,
          child: ListView(
            padding: const EdgeInsets.all(JantokSpace.md),
            children: [
              const Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  JantokWordmark(compact: true),
                  Icon(Icons.notifications_none),
                ],
              ),
              const SizedBox(height: JantokSpace.lg),
              Text(
                l.todayMeals,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: JantokSpace.sm),
              if (todayDay == null)
                _EmptyCard(icon: Icons.restaurant_outlined, text: l.noMenu)
              else
                ...(todayDay['options'] as List<dynamic>)
                    .take(3)
                    .map(
                      (raw) => MealTile(
                        option: raw as Map<String, dynamic>,
                        memberId: members.isEmpty
                            ? null
                            : '${members.first['id']}',
                      ),
                    ),
              const SizedBox(height: JantokSpace.lg),
              Text(
                l.subscription,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.calendar_month),
                  title: Text(
                    subscription == null ? l.noSubscription : l.active,
                  ),
                  subtitle: Text(
                    subscription == null
                        ? l.startSubscription
                        : l.daysCount(planned),
                  ),
                  trailing: members.isEmpty
                      ? const Icon(Icons.chevron_right)
                      : IconButton(
                          tooltip: l.recommendation,
                          onPressed: () => _push(
                            context,
                            RecommendationScreen(
                              memberId: '${members.first['id']}',
                              memberName: '${members.first['firstName']}',
                            ),
                          ),
                          icon: const Icon(Icons.auto_awesome),
                        ),
                  onTap: () => _push(
                    context,
                    subscription == null
                        ? const CheckoutScreen()
                        : const SubscriptionScreen(),
                  ),
                ),
              ),
              const SizedBox(height: JantokSpace.lg),
              Text(
                l.quickActions,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              GridView.count(
                crossAxisCount: MediaQuery.sizeOf(context).width > 520 ? 4 : 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                childAspectRatio: 1.8,
                children: [
                  _ActionCard(
                    Icons.person_add_alt,
                    l.family,
                    () => _push(context, const FamilyScreen()),
                  ),
                  _ActionCard(
                    Icons.add_shopping_cart,
                    l.addons,
                    () => _push(context, const AddonsScreen()),
                  ),
                  _ActionCard(
                    Icons.payments_outlined,
                    l.payments,
                    () => _push(context, const PaymentsScreen()),
                  ),
                  _ActionCard(
                    Icons.support_agent,
                    l.support,
                    () => _push(context, const SupportScreen()),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class MenuScreen extends ConsumerStatefulWidget {
  const MenuScreen({super.key});
  @override
  ConsumerState<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends ApiPageState<MenuScreen> {
  Map<String, dynamic>? household;
  Map<String, dynamic>? menu;
  String? memberId;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    if (!loading) beginLoad();
    try {
      final api = ref.read(legacy.apiProvider);
      final values = await Future.wait([
        api.call('GET', '/household'),
        api.call('GET', '/menu'),
      ]);
      final members = values[0]['members'] as List<dynamic>? ?? [];
      if (mounted) {
        setState(() {
          household = values[0];
          menu = values[1];
          memberId ??= members.isEmpty ? null : '${members.first['id']}';
          loading = false;
        });
      }
    } catch (caught) {
      fail(caught);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final members = household?['members'] as List<dynamic>? ?? [];
    final days = menu?['days'] as List<dynamic>? ?? [];
    return SafeArea(
      child: AsyncStateView(
        loading: loading,
        error: error,
        onRetry: load,
        child: RefreshIndicator(
          onRefresh: load,
          child: ListView(
            padding: const EdgeInsets.all(JantokSpace.md),
            children: [
              Text(
                l.sevenDayMenu,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: JantokSpace.sm),
              if (members.isNotEmpty)
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: members.map((raw) {
                      final m = raw as Map<String, dynamic>;
                      return Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text('${m['firstName']}'),
                          selected: memberId == m['id'],
                          onSelected: (_) =>
                              setState(() => memberId = '${m['id']}'),
                        ),
                      );
                    }).toList(),
                  ),
                ),
              const SizedBox(height: JantokSpace.md),
              if (days.isEmpty)
                _EmptyCard(icon: Icons.event_busy, text: l.noMenu),
              ...days.map((raw) {
                final day = raw as Map<String, dynamic>;
                final date = DateTime.parse('${day['serviceDate']}');
                return Card(
                  child: ExpansionTile(
                    initiallyExpanded: raw == days.first,
                    title: Text(
                      DateFormat.MMMEd(
                        Localizations.localeOf(context).languageCode,
                      ).format(date),
                    ),
                    subtitle: day['serviceDayStatus'] == null
                        ? null
                        : Text('${day['serviceDayStatus']}'),
                    children: (day['options'] as List<dynamic>)
                        .map(
                          (option) => MealTile(
                            option: option as Map<String, dynamic>,
                            memberId: memberId,
                            serviceDate: '${day['serviceDate']}'
                                .split('T')
                                .first,
                          ),
                        )
                        .toList(),
                  ),
                );
              }),
            ],
          ),
        ),
      ),
    );
  }
}

class MealTile extends ConsumerWidget {
  const MealTile({
    super.key,
    required this.option,
    required this.memberId,
    this.serviceDate,
  });
  final Map<String, dynamic> option;
  final String? memberId;
  final String? serviceDate;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final meal = option['meal'] as Map<String, dynamic>;
    final name = _translated(
      meal['translations'],
      Localizations.localeOf(context).languageCode,
      '${meal['code']}',
    );
    final safety = (option['memberSafety'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>()
        .where((s) => s['memberId'] == memberId)
        .firstOrNull;
    final safe = safety?['safe'] == true;
    return ListTile(
      leading: CircleAvatar(
        child: Icon(safe ? Icons.restaurant : Icons.warning_amber),
      ),
      title: Text(name),
      subtitle: Text(
        '${_mealType(context, '${option['mealType']}')} · ${meal['caloriesKcal']} kcal · ${meal['servingWeightGrams']} g',
      ),
      trailing: serviceDate == null
          ? const Icon(Icons.chevron_right)
          : IconButton(
              tooltip: AppLocalizations.of(context).save,
              onPressed: safe && memberId != null
                  ? () async {
                      try {
                        await ref
                            .read(legacy.apiProvider)
                            .call(
                              'POST',
                              '/members/$memberId/meal-selections',
                              body: {
                                'mealId': meal['id'],
                                'serviceDate': serviceDate,
                                'mealType': option['mealType'],
                                'removedIngredientIds': <String>[],
                                'addedIngredientIds': <String>[],
                                'addonIds': <String>[],
                              },
                            );
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                AppLocalizations.of(context).settingsApplied,
                              ),
                            ),
                          );
                        }
                      } catch (caught) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context)
                              .showSnackBar(SnackBar(content: Text('$caught')));
                        }
                      }
                    }
                  : null,
              icon: const Icon(Icons.check_circle_outline),
            ),
      onTap: () =>
          _push(context, MealDetailsScreen(option: option, memberId: memberId)),
    );
  }
}

class MealDetailsScreen extends StatelessWidget {
  const MealDetailsScreen({super.key, required this.option, this.memberId});
  final Map<String, dynamic> option;
  final String? memberId;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final meal = option['meal'] as Map<String, dynamic>;
    final locale = Localizations.localeOf(context).languageCode;
    final name = _translated(meal['translations'], locale, '${meal['code']}');
    final safety = (option['memberSafety'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>()
        .where((s) => s['memberId'] == memberId)
        .firstOrNull;
    final safe = safety?['safe'] == true;
    final ingredients = meal['ingredients'] as List<dynamic>? ?? [];
    final risks = meal['allergenRisks'] as List<dynamic>? ?? [];
    final reviews = meal['reviews'] as List<dynamic>? ?? [];
    return Scaffold(
      appBar: AppBar(title: Text(l.mealDetails)),
      body: ListView(
        padding: const EdgeInsets.all(JantokSpace.md),
        children: [
          const FoodPhotoFallback(),
          const SizedBox(height: JantokSpace.md),
          Text(name, style: Theme.of(context).textTheme.headlineSmall),
          Text(
            '${l.calories(meal['caloriesKcal'])} · ${l.grams(meal['servingWeightGrams'])}',
          ),
          const SizedBox(height: JantokSpace.md),
          Card(
            color: safe
                ? Theme.of(context).colorScheme.primaryContainer
                : Theme.of(context).colorScheme.errorContainer,
            child: ListTile(
              leading: Icon(safe ? Icons.verified_user : Icons.warning_amber),
              title: Text(safe ? l.safeForMember : l.allergyWarning),
              subtitle:
                  safety == null ||
                      (safety['reasons'] as List<dynamic>? ?? []).isEmpty
                  ? null
                  : Text((safety['reasons'] as List<dynamic>).join('\n')),
            ),
          ),
          _Section(
            title: l.composition,
            children: ingredients.map((raw) {
              final i =
                  (raw as Map<String, dynamic>)['ingredient']
                      as Map<String, dynamic>;
              return Text('• ${i['nameRu'] ?? i['code']}');
            }).toList(),
          ),
          _Section(
            title: l.allergens,
            children: risks.isEmpty
                ? [Text(l.empty)]
                : risks.map((raw) {
                    final a =
                        (raw as Map<String, dynamic>)['allergen']
                            as Map<String, dynamic>;
                    return Text('• ${a['nameRu'] ?? a['code']}');
                  }).toList(),
          ),
          _Section(
            title: l.reviews,
            children: reviews.isEmpty
                ? [Text(l.empty)]
                : reviews.map((raw) {
                    final r = raw as Map<String, dynamic>;
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Text('${r['rating']} ★'),
                      title: Text('${r['comment'] ?? ''}'),
                    );
                  }).toList(),
          ),
        ],
      ),
    );
  }
}

class DeliveryScreen extends ConsumerStatefulWidget {
  const DeliveryScreen({super.key});
  @override
  ConsumerState<DeliveryScreen> createState() => _DeliveryScreenState();
}

class _DeliveryScreenState extends ApiPageState<DeliveryScreen> {
  Map<String, dynamic>? tracking;
  bool noDelivery = false;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    if (!loading) beginLoad();
    try {
      final api = ref.read(legacy.apiProvider);
      final subscription = await api.call('GET', '/subscriptions/current');
      final days = subscription['serviceDays'] as List<dynamic>? ?? [];
      final withDelivery = days
          .cast<Map<String, dynamic>>()
          .where((d) => d['dailyFulfillment'] != null)
          .toList();
      if (withDelivery.isEmpty) {
        if (mounted) {
          setState(() {
            noDelivery = true;
            loading = false;
          });
        }
        return;
      }
      final fulfillment =
          withDelivery.first['dailyFulfillment'] as Map<String, dynamic>;
      final value = await api.call(
        'GET',
        '/deliveries/daily-orders/${fulfillment['id']}/tracking',
      );
      if (mounted) {
        setState(() {
          tracking = value;
          noDelivery = false;
          loading = false;
        });
      }
    } catch (caught) {
      fail(caught);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final courier = tracking?['courier'] as Map<String, dynamic>?;
    final point = tracking?['tracking'] as Map<String, dynamic>?;
    final eta = tracking?['eta'] as Map<String, dynamic>?;
    final phone = courier?['phone']?.toString();
    return SafeArea(
      child: AsyncStateView(
        loading: loading,
        error: error,
        onRetry: load,
        child: RefreshIndicator(
          onRefresh: load,
          child: ListView(
            padding: const EdgeInsets.all(JantokSpace.md),
            children: [
              Text(
                l.deliveryTracking,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: JantokSpace.md),
              if (noDelivery)
                _EmptyCard(icon: Icons.local_shipping_outlined, text: l.empty)
              else ...[
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.route),
                    title: Text('${tracking?['status'] ?? '—'}'),
                    subtitle: Text('${tracking?['slot'] ?? ''}'),
                  ),
                ),
                Container(
                  height: 240,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surfaceContainerHigh,
                    borderRadius: BorderRadius.circular(JantokRadius.card),
                  ),
                  child: Center(
                    child: point?['latitude'] == null
                        ? Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.map_outlined, size: 56),
                              const SizedBox(height: 8),
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 24,
                                ),
                                child: Text(
                                  l.trackingUnavailable,
                                  textAlign: TextAlign.center,
                                ),
                              ),
                            ],
                          )
                        : Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.location_pin, size: 56),
                              Text(
                                '${point?['latitude']}, ${point?['longitude']}',
                              ),
                            ],
                          ),
                  ),
                ),
                ListTile(
                  leading: const Icon(Icons.schedule),
                  title: Text(eta?['eta']?.toString() ?? l.etaUnavailable),
                ),
                if (phone != null)
                  FilledButton.icon(
                    onPressed: () => launchUrl(Uri(scheme: 'tel', path: phone)),
                    icon: const Icon(Icons.phone),
                    label: Text(l.callCourier),
                  ),
              ],
              const SizedBox(height: JantokSpace.sm),
              OutlinedButton.icon(
                onPressed: () => _push(context, const SupportScreen()),
                icon: const Icon(Icons.support_agent),
                label: Text(l.contactSupport),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class ClubDashboardScreen extends ConsumerStatefulWidget {
  const ClubDashboardScreen({super.key});
  @override
  ConsumerState<ClubDashboardScreen> createState() =>
      _ClubDashboardScreenState();
}

class _ClubDashboardScreenState extends ApiPageState<ClubDashboardScreen> {
  Map<String, dynamic>? data;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    if (!loading) beginLoad();
    try {
      final value = await ref
          .read(legacy.apiProvider)
          .call('GET', '/loyalty/club');
      if (mounted) {
        setState(() {
          data = value;
          loading = false;
        });
      }
    } catch (caught) {
      fail(caught);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final wallet = data?['wallet'] as Map<String, dynamic>?;
    final membership = data?['membership'] as Map<String, dynamic>?;
    final tier = membership?['tier'] as Map<String, dynamic>?;
    final next = data?['nextTier'] as Map<String, dynamic>?;
    final cycles =
        (membership?['qualifyingPaidCycles'] as num?)?.toDouble() ?? 0;
    final threshold = (next?['thresholdPaidCycles'] as num?)?.toDouble() ?? 1;
    final friends = data?['invitedFriends'] as List<dynamic>? ?? [];
    return SafeArea(
      child: AsyncStateView(
        loading: loading,
        error: error,
        onRetry: load,
        child: RefreshIndicator(
          onRefresh: load,
          child: ListView(
            padding: const EdgeInsets.all(JantokSpace.md),
            children: [
              const JantokWordmark(compact: true),
              const SizedBox(height: JantokSpace.lg),
              Text(
                tier?['nameRu']?.toString() ?? 'JANTOK CLUB',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: JantokSpace.md),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.toll),
                  title: Text(l.bonusBalance),
                  subtitle: Text('${wallet?['availableKzt'] ?? 0} ₸'),
                  trailing: Text('${wallet?['reservedKzt'] ?? 0} reserved'),
                ),
              ),
              Text(l.progress, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: JantokSpace.xs),
              LinearProgressIndicator(value: (cycles / threshold).clamp(0, 1)),
              const SizedBox(height: JantokSpace.md),
              SelectableText('Referral: ${data?['referralCode'] ?? '—'}'),
              const SizedBox(height: JantokSpace.lg),
              Text(
                l.invitedFriends,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              if (friends.isEmpty) Text(l.empty),
              ...friends.map(
                (raw) => ListTile(
                  leading: const Icon(Icons.person_outline),
                  title: Text('${raw['displayName']}'),
                  subtitle: Text('${raw['status']}'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});
  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ApiPageState<ProfileScreen> {
  Map<String, dynamic>? household;
  Map<String, dynamic>? preferences;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    if (!loading) beginLoad();
    try {
      final api = ref.read(legacy.apiProvider);
      final values = await Future.wait([
        api.call('GET', '/household'),
        api.call('GET', '/support/notification-preferences'),
      ]);
      if (mounted) {
        setState(() {
          household = values[0];
          preferences = values[1];
          loading = false;
        });
      }
    } catch (caught) {
      fail(caught);
    }
  }

  Future<void> updatePreference(String key, bool value) async {
    final next = {
      ...?preferences,
      key: value,
      'locale': Localizations.localeOf(context).languageCode,
    };
    final saved = await ref
        .read(legacy.apiProvider)
        .call('PATCH', '/support/notification-preferences', body: next);
    if (mounted) setState(() => preferences = saved);
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final members = household?['members'] as List<dynamic>? ?? [];
    return SafeArea(
      child: AsyncStateView(
        loading: loading,
        error: error,
        onRetry: load,
        child: ListView(
          padding: const EdgeInsets.all(JantokSpace.md),
          children: [
            Text(l.profile, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: JantokSpace.md),
            const LanguagePicker(),
            const SizedBox(height: JantokSpace.md),
            _NavTile(
              Icons.family_restroom,
              '${l.family} (${members.length})',
              () => _push(context, const FamilyScreen()),
            ),
            _NavTile(
              Icons.location_on_outlined,
              l.addresses,
              () => _push(context, const legacy.AddressScreen()),
            ),
            _NavTile(
              Icons.calendar_month,
              l.subscriptionCalendar,
              () => _push(context, const SubscriptionScreen()),
            ),
            _NavTile(
              Icons.payments_outlined,
              l.payments,
              () => _push(context, const PaymentsScreen()),
            ),
            _NavTile(
              Icons.star_outline,
              l.myReviews,
              () => _push(context, const ReviewsScreen()),
            ),
            _NavTile(
              Icons.support_agent,
              l.support,
              () => _push(context, const SupportScreen()),
            ),
            const SizedBox(height: JantokSpace.lg),
            Text(
              l.notifications,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            SwitchListTile(
              title: Text(l.serviceNotifications),
              value: preferences?['servicePushEnabled'] == true,
              onChanged: (v) => updatePreference('servicePushEnabled', v),
            ),
            SwitchListTile(
              title: Text(l.marketingNotifications),
              value: preferences?['marketingPushEnabled'] == true,
              onChanged: (v) => updatePreference('marketingPushEnabled', v),
            ),
            _NavTile(
              Icons.devices,
              l.sessions,
              () => _push(context, const SessionsScreen()),
            ),
            const SizedBox(height: JantokSpace.lg),
            OutlinedButton.icon(
              onPressed: () => ref.read(legacy.authProvider.notifier).logout(),
              icon: const Icon(Icons.logout),
              label: Text(l.logout),
            ),
          ],
        ),
      ),
    );
  }
}

class FamilyScreen extends ConsumerStatefulWidget {
  const FamilyScreen({super.key});
  @override
  ConsumerState<FamilyScreen> createState() => _FamilyScreenState();
}

class _FamilyScreenState extends ApiPageState<FamilyScreen> {
  Map<String, dynamic>? household;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    if (!loading) beginLoad();
    try {
      final value = await ref
          .read(legacy.apiProvider)
          .call('GET', '/household');
      if (mounted) {
        setState(() {
          household = value;
          loading = false;
        });
      }
    } catch (caught) {
      fail(caught);
    }
  }

  Future<void> addMember() async {
    final l = AppLocalizations.of(context);
    final name = TextEditingController();
    final birth = TextEditingController();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.addMember),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: name,
              decoration: InputDecoration(labelText: l.firstName),
            ),
            const SizedBox(height: JantokSpace.sm),
            TextField(
              controller: birth,
              keyboardType: TextInputType.datetime,
              decoration: InputDecoration(labelText: l.birthDate),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(l.save),
          ),
        ],
      ),
    );
    if (submitted != true) return;
    await ref
        .read(legacy.apiProvider)
        .call(
          'POST',
          '/household/members',
          body: {'firstName': name.text.trim(), 'birthDate': birth.text.trim()},
        );
    await load();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final members = household?['members'] as List<dynamic>? ?? [];
    return Scaffold(
      appBar: AppBar(title: Text(l.family)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: addMember,
        icon: const Icon(Icons.person_add),
        label: Text(l.addMember),
      ),
      body: AsyncStateView(
        loading: loading,
        error: error,
        onRetry: load,
        child: ListView(
          padding: const EdgeInsets.all(JantokSpace.md),
          children: [
            ...members.map((raw) {
              final member = raw as Map<String, dynamic>;
              return Card(
                child: ListTile(
                  leading: const CircleAvatar(
                    child: Icon(Icons.person_outline),
                  ),
                  title: Text('${member['firstName']}'),
                  subtitle: Text('${member['birthDate']}'.split('T').first),
                  trailing: IconButton(
                    tooltip: l.recommendation,
                    onPressed: () => _push(
                      context,
                      RecommendationScreen(
                        memberId: '${member['id']}',
                        memberName: '${member['firstName']}',
                      ),
                    ),
                    icon: const Icon(Icons.auto_awesome),
                  ),
                  onTap: () => _push(
                    context,
                    QuestionnaireStage8Screen(
                      memberId: '${member['id']}',
                      memberName: '${member['firstName']}',
                    ),
                  ),
                ),
              );
            }),
            const SizedBox(height: JantokSpace.md),
            OutlinedButton.icon(
              onPressed: () => _push(context, const legacy.AddressScreen()),
              icon: const Icon(Icons.location_on_outlined),
              label: Text(l.deliveryAddress),
            ),
          ],
        ),
      ),
    );
  }
}

class RecommendationScreen extends ConsumerStatefulWidget {
  const RecommendationScreen({
    super.key,
    required this.memberId,
    required this.memberName,
  });

  final String memberId;
  final String memberName;

  @override
  ConsumerState<RecommendationScreen> createState() =>
      _RecommendationScreenState();
}

class _RecommendationScreenState extends ConsumerState<RecommendationScreen> {
  Map<String, dynamic>? recommendation;
  Object? error;
  bool loading = false;

  Future<void> calculate() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final start = DateTime.now().add(const Duration(days: 2));
      final value = await ref
          .read(legacy.apiProvider)
          .call(
            'POST',
            '/members/${widget.memberId}/recommendations',
            body: {
              'serviceStartDate': start.toIso8601String().split('T').first,
            },
          );
      if (mounted) setState(() => recommendation = value);
    } catch (caught) {
      if (mounted) setState(() => error = caught);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final data = recommendation;
    final blocked = data?['blockedMeals'] as Map<String, dynamic>? ?? const {};
    return Scaffold(
      appBar: AppBar(title: Text('${l.recommendation} · ${widget.memberName}')),
      body: ListView(
        padding: const EdgeInsets.all(JantokSpace.md),
        children: [
          if (error != null) ...[
            Card(
              child: ListTile(
                leading: const Icon(Icons.error_outline),
                title: Text('$error'),
                trailing: TextButton(
                  onPressed: calculate,
                  child: Text(l.retry),
                ),
              ),
            ),
            const SizedBox(height: JantokSpace.md),
          ],
          if (data == null)
            _EmptyCard(icon: Icons.auto_awesome_outlined, text: l.empty)
          else ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(JantokSpace.md),
                child: Wrap(
                  spacing: JantokSpace.lg,
                  runSpacing: JantokSpace.md,
                  children: [
                    _Metric(
                      label: l.calories('${data['caloriesKcal']}'),
                      value: '${data['recommendedPortion']}',
                    ),
                    _Metric(
                      label: 'P',
                      value: l.grams('${data['proteinGrams']}'),
                    ),
                    _Metric(label: 'F', value: l.grams('${data['fatGrams']}')),
                    _Metric(label: 'C', value: l.grams('${data['carbGrams']}')),
                  ],
                ),
              ),
            ),
            Card(
              child: ListTile(
                leading: const Icon(Icons.verified_user_outlined),
                title: Text(l.safeForMember),
                subtitle: Text(
                  '${(data['allowedMealIds'] as List<dynamic>? ?? const []).length} · '
                  '${l.allergy}: ${blocked.length}',
                ),
              ),
            ),
          ],
          const SizedBox(height: JantokSpace.md),
          FilledButton.icon(
            onPressed: loading ? null : calculate,
            icon: loading
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.calculate_outlined),
            label: Text(l.generateRecommendation),
          ),
        ],
      ),
    );
  }
}

class QuestionnaireStage8Screen extends ConsumerStatefulWidget {
  const QuestionnaireStage8Screen({
    super.key,
    required this.memberId,
    required this.memberName,
  });
  final String memberId;
  final String memberName;
  @override
  ConsumerState<QuestionnaireStage8Screen> createState() =>
      _QuestionnaireStage8ScreenState();
}

class _QuestionnaireStage8ScreenState
    extends ConsumerState<QuestionnaireStage8Screen> {
  Map<String, dynamic>? catalogs;
  Object? error;
  bool saving = false;
  final height = TextEditingController(text: '170');
  final weight = TextEditingController(text: '70');
  final sportHours = TextEditingController(text: '0');
  final otherAllergy = TextEditingController();
  final notes = TextEditingController();
  String sex = 'UNSPECIFIED';
  String intensity = 'NONE';
  String goal = 'MAINTAIN';
  String portion = 'RECOMMENDED';
  String? activityId;
  String? dietId;
  String? allergenId;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final value = await ref
          .read(legacy.apiProvider)
          .call('GET', '/catalogs/questionnaire');
      if (mounted) {
        setState(() {
          catalogs = value;
          final activities = value['activityLevels'] as List<dynamic>;
          final diets = value['dietTypes'] as List<dynamic>;
          activityId = activities.isEmpty ? null : '${activities.first['id']}';
          dietId = diets.isEmpty ? null : '${diets.first['id']}';
          error = null;
        });
      }
    } catch (caught) {
      if (mounted) setState(() => error = caught);
    }
  }

  String catalogName(Map<String, dynamic> item) {
    final locale = Localizations.localeOf(context).languageCode;
    return '${item[locale == 'kk'
            ? 'nameKk'
            : locale == 'en'
            ? 'nameEn'
            : 'nameRu'] ?? item['nameRu'] ?? item['code']}';
  }

  Future<void> save() async {
    final l = AppLocalizations.of(context);
    if (activityId == null ||
        dietId == null ||
        double.tryParse(height.text) == null ||
        double.tryParse(weight.text) == null) {
      setState(() => error = l.requiredFields);
      return;
    }
    setState(() {
      saving = true;
      error = null;
    });
    try {
      await ref
          .read(legacy.apiProvider)
          .call(
            'PUT',
            '/household/members/${widget.memberId}/questionnaire',
            body: {
              'biologicalSex': sex,
              'heightCm': double.parse(height.text),
              'weightKg': double.parse(weight.text),
              'activityLevelId': activityId,
              'sportIntensity': intensity,
              'sportHoursPerWeek': double.tryParse(sportHours.text) ?? 0,
              'goal': goal,
              'dietTypeId': dietId,
              'allergyDeclarationStatus':
                  allergenId == null && otherAllergy.text.trim().isEmpty
                  ? 'NONE'
                  : 'DECLARED',
              'portionPreference': portion,
              'sportTypeIds': <String>[],
              'allergies': allergenId != null
                  ? [
                      {'allergenId': allergenId},
                    ]
                  : otherAllergy.text.trim().isNotEmpty
                  ? [
                      {'freeText': otherAllergy.text.trim()},
                    ]
                  : <Map<String, dynamic>>[],
              'preferences': <Map<String, dynamic>>[],
              'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
            },
          );
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(l.questionnaireSaved)));
      }
    } catch (caught) {
      if (mounted) setState(() => error = caught);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    if (catalogs == null) {
      return Scaffold(
        appBar: AppBar(title: Text(l.familyQuestionnaire)),
        body: AsyncStateView(
          loading: error == null,
          error: error,
          onRetry: load,
          child: const SizedBox(),
        ),
      );
    }
    final activities = catalogs!['activityLevels'] as List<dynamic>;
    final diets = catalogs!['dietTypes'] as List<dynamic>;
    final allergens = catalogs!['allergens'] as List<dynamic>;
    return Scaffold(
      appBar: AppBar(
        title: Text('${l.familyQuestionnaire} · ${widget.memberName}'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(JantokSpace.md),
        children: [
          DropdownButtonFormField(
            initialValue: sex,
            decoration: InputDecoration(labelText: l.biologicalSex),
            items: [
              DropdownMenuItem(
                value: 'UNSPECIFIED',
                child: Text(l.notSpecified),
              ),
              DropdownMenuItem(value: 'FEMALE', child: Text(l.female)),
              DropdownMenuItem(value: 'MALE', child: Text(l.male)),
            ],
            onChanged: (v) => setState(() => sex = v!),
          ),
          const SizedBox(height: JantokSpace.sm),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: height,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: l.heightCm),
                ),
              ),
              const SizedBox(width: JantokSpace.sm),
              Expanded(
                child: TextField(
                  controller: weight,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: l.weightKg),
                ),
              ),
            ],
          ),
          const SizedBox(height: JantokSpace.sm),
          DropdownButtonFormField(
            initialValue: activityId,
            decoration: InputDecoration(labelText: l.activityLevel),
            items: activities.map((raw) {
              final item = raw as Map<String, dynamic>;
              return DropdownMenuItem(
                value: '${item['id']}',
                child: Text(catalogName(item)),
              );
            }).toList(),
            onChanged: (v) => setState(() => activityId = v),
          ),
          const SizedBox(height: JantokSpace.sm),
          DropdownButtonFormField(
            initialValue: intensity,
            decoration: InputDecoration(labelText: l.sportIntensity),
            items: [
              DropdownMenuItem(value: 'NONE', child: Text(l.none)),
              DropdownMenuItem(value: 'LIGHT', child: Text(l.light)),
              DropdownMenuItem(value: 'MODERATE', child: Text(l.moderate)),
              DropdownMenuItem(value: 'HIGH', child: Text(l.high)),
            ],
            onChanged: (v) => setState(() => intensity = v!),
          ),
          const SizedBox(height: JantokSpace.sm),
          TextField(
            controller: sportHours,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: l.sportHours),
          ),
          const SizedBox(height: JantokSpace.sm),
          DropdownButtonFormField(
            initialValue: goal,
            decoration: InputDecoration(labelText: l.goal),
            items: [
              DropdownMenuItem(value: 'LOSE_WEIGHT', child: Text(l.loseWeight)),
              DropdownMenuItem(
                value: 'MAINTAIN',
                child: Text(l.maintainWeight),
              ),
              DropdownMenuItem(value: 'GAIN_WEIGHT', child: Text(l.gainWeight)),
              DropdownMenuItem(value: 'SPORT', child: Text(l.sportGoal)),
            ],
            onChanged: (v) => setState(() => goal = v!),
          ),
          const SizedBox(height: JantokSpace.sm),
          DropdownButtonFormField(
            initialValue: dietId,
            decoration: InputDecoration(labelText: l.dietType),
            items: diets.map((raw) {
              final item = raw as Map<String, dynamic>;
              return DropdownMenuItem(
                value: '${item['id']}',
                child: Text(catalogName(item)),
              );
            }).toList(),
            onChanged: (v) => setState(() => dietId = v),
          ),
          const SizedBox(height: JantokSpace.sm),
          DropdownButtonFormField(
            initialValue: portion,
            decoration: InputDecoration(labelText: l.portionSize),
            items: [
              DropdownMenuItem(
                value: 'RECOMMENDED',
                child: Text(l.recommended),
              ),
              DropdownMenuItem(value: 'SMALL', child: Text(l.small)),
              DropdownMenuItem(value: 'STANDARD', child: Text(l.standard)),
              DropdownMenuItem(value: 'LARGE', child: Text(l.large)),
            ],
            onChanged: (v) => setState(() => portion = v!),
          ),
          const SizedBox(height: JantokSpace.sm),
          DropdownButtonFormField<String?>(
            initialValue: allergenId,
            decoration: InputDecoration(labelText: l.allergy),
            items: [
              DropdownMenuItem(value: null, child: Text(l.none)),
              ...allergens.map((raw) {
                final item = raw as Map<String, dynamic>;
                return DropdownMenuItem(
                  value: '${item['id']}',
                  child: Text(catalogName(item)),
                );
              }),
            ],
            onChanged: (v) => setState(() => allergenId = v),
          ),
          const SizedBox(height: JantokSpace.sm),
          TextField(
            controller: otherAllergy,
            decoration: InputDecoration(labelText: l.otherAllergy),
          ),
          const SizedBox(height: JantokSpace.sm),
          TextField(
            controller: notes,
            minLines: 2,
            maxLines: 4,
            decoration: InputDecoration(labelText: l.notes),
          ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: JantokSpace.sm),
              child: Text(
                '$error',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          const SizedBox(height: JantokSpace.md),
          FilledButton(
            onPressed: saving ? null : save,
            child: Text(l.saveQuestionnaire),
          ),
        ],
      ),
    );
  }
}

class SubscriptionScreen extends ConsumerStatefulWidget {
  const SubscriptionScreen({super.key});
  @override
  ConsumerState<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends ApiPageState<SubscriptionScreen> {
  Map<String, dynamic>? subscription;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    if (!loading) beginLoad();
    try {
      final v = await ref
          .read(legacy.apiProvider)
          .call('GET', '/subscriptions/current');
      if (mounted) {
        setState(() {
          subscription = v.isEmpty ? null : v;
          loading = false;
        });
      }
    } catch (e) {
      fail(e);
    }
  }

  Future<void> skip(String date) async {
    await ref
        .read(legacy.apiProvider)
        .call(
          'POST',
          '/subscriptions/${subscription!['id']}/skip',
          body: {
            'serviceDate': date,
            'idempotencyKey': 'mobile-skip-${subscription!['id']}-$date',
          },
        );
    await load();
  }

  Future<void> autoRenew(bool enabled) async {
    await ref
        .read(legacy.apiProvider)
        .call(
          'POST',
          '/subscriptions/${subscription!['id']}/auto-renew',
          body: {'enabled': enabled, 'termsAccepted': enabled},
        );
    await load();
  }

  Future<void> pauseSubscription() async {
    final now = DateTime.now();
    final start = TextEditingController(
      text: DateFormat('yyyy-MM-dd').format(now.add(const Duration(days: 2))),
    );
    final end = TextEditingController(
      text: DateFormat('yyyy-MM-dd').format(now.add(const Duration(days: 3))),
    );
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(AppLocalizations.of(context).pause),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: start,
              keyboardType: TextInputType.datetime,
              decoration: const InputDecoration(labelText: 'YYYY-MM-DD'),
            ),
            const SizedBox(height: JantokSpace.sm),
            TextField(
              controller: end,
              keyboardType: TextInputType.datetime,
              decoration: const InputDecoration(labelText: 'YYYY-MM-DD'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(AppLocalizations.of(context).cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(AppLocalizations.of(context).pause),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    beginLoad();
    try {
      await ref
          .read(legacy.apiProvider)
          .call(
            'POST',
            '/subscriptions/${subscription!['id']}/pauses',
            body: {
              'startDate': start.text.trim(),
              'endDate': end.text.trim(),
              'idempotencyKey':
                  'mobile-pause-${subscription!['id']}-${start.text}-${end.text}',
            },
          );
      await load();
    } catch (caught) {
      fail(caught);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final days = subscription?['serviceDays'] as List<dynamic>? ?? [];
    return Scaffold(
      appBar: AppBar(title: Text(l.subscriptionCalendar)),
      body: AsyncStateView(
        loading: loading,
        error: error,
        onRetry: load,
        child: subscription == null
            ? Center(
                child: FilledButton(
                  onPressed: () => _push(context, const CheckoutScreen()),
                  child: Text(l.startSubscription),
                ),
              )
            : ListView(
                padding: const EdgeInsets.all(JantokSpace.md),
                children: [
                  Card(
                    child: Column(
                      children: [
                        ListTile(
                          title: Text('${subscription!['status']}'),
                          subtitle: Text(
                            '${'${subscription!['startDate']}'.split('T').first} — ${'${subscription!['currentEndDate']}'.split('T').first}',
                          ),
                        ),
                        SwitchListTile(
                          title: Text(l.autoRenew),
                          value: subscription!['autoRenew'] == true,
                          onChanged: autoRenew,
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                          child: Row(
                            children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: pauseSubscription,
                                  icon: const Icon(Icons.pause_circle_outline),
                                  label: Text(l.pause),
                                ),
                              ),
                              const SizedBox(width: JantokSpace.sm),
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: () => _push(
                                    context,
                                    GuestScreen(subscription: subscription!),
                                  ),
                                  icon: const Icon(Icons.person_add_alt),
                                  label: Text(l.guest),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    '${l.remainingDays}: ${days.where((d) => d['status'] == 'PLANNED').length}',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: JantokSpace.sm),
                  ...days.map((raw) {
                    final d = raw as Map<String, dynamic>;
                    final date = '${d['serviceDate']}'.split('T').first;
                    return Card(
                      child: ListTile(
                        leading: Icon(
                          d['status'] == 'PLANNED'
                              ? Icons.check_circle_outline
                              : Icons.event_busy,
                        ),
                        title: Text(date),
                        subtitle: Text('${d['status']}'),
                        trailing: d['status'] == 'PLANNED'
                            ? TextButton(
                                onPressed: () => skip(date),
                                child: Text(l.skipDay),
                              )
                            : null,
                      ),
                    );
                  }),
                ],
              ),
      ),
    );
  }
}

class GuestScreen extends ConsumerStatefulWidget {
  const GuestScreen({super.key, required this.subscription});
  final Map<String, dynamic> subscription;

  @override
  ConsumerState<GuestScreen> createState() => _GuestScreenState();
}

class _GuestScreenState extends ConsumerState<GuestScreen> {
  final name = TextEditingController();
  final bonuses = TextEditingController(text: '0');
  Map<String, dynamic>? quote;
  Object? error;
  bool loading = false;
  String? selectedDate;
  String? result;

  List<String> get dates =>
      (widget.subscription['serviceDays'] as List<dynamic>? ?? const [])
          .where((day) => day['status'] == 'PLANNED')
          .map((day) => '${day['serviceDate']}'.split('T').first)
          .toList();

  Future<void> calculate() async {
    final date = selectedDate ?? dates.firstOrNull;
    if (name.text.trim().isEmpty || date == null) return;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final value = await ref
          .read(legacy.apiProvider)
          .call(
            'POST',
            '/subscriptions/${widget.subscription['id']}/guest-quotes',
            body: {
              'displayName': name.text.trim(),
              'serviceDates': [date],
              'nutritionSnapshot': <String, dynamic>{},
              'allergySnapshot': <String, dynamic>{},
              'bonusKzt': int.tryParse(bonuses.text) ?? 0,
            },
          );
      if (mounted) setState(() => quote = value);
    } catch (caught) {
      if (mounted) setState(() => error = caught);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> checkout() async {
    if (quote == null) return;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final value = await ref
          .read(legacy.apiProvider)
          .call(
            'POST',
            '/subscriptions/${widget.subscription['id']}/change-checkout',
            body: {
              'quoteId': quote!['id'],
              'idempotencyKey': 'mobile-guest-${quote!['id']}',
            },
          );
      if (mounted) setState(() => result = '${value['status'] ?? 'PENDING'}');
    } catch (caught) {
      if (mounted) setState(() => error = caught);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    selectedDate ??= dates.firstOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(l.guest)),
      body: ListView(
        padding: const EdgeInsets.all(JantokSpace.md),
        children: [
          TextField(
            controller: name,
            decoration: InputDecoration(labelText: l.firstName),
          ),
          const SizedBox(height: JantokSpace.sm),
          DropdownButtonFormField<String>(
            initialValue: selectedDate,
            decoration: InputDecoration(labelText: l.calendar),
            items: dates
                .map((date) => DropdownMenuItem(value: date, child: Text(date)))
                .toList(),
            onChanged: (value) => setState(() {
              selectedDate = value;
              quote = null;
            }),
          ),
          const SizedBox(height: JantokSpace.sm),
          TextField(
            controller: bonuses,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: l.bonusesToSpend),
          ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: JantokSpace.sm),
              child: Text(
                '$error',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          const SizedBox(height: JantokSpace.md),
          FilledButton.tonal(
            onPressed: loading ? null : calculate,
            child: Text(l.quote),
          ),
          if (quote != null) ...[
            ListTile(
              title: Text(l.total),
              trailing: Text(l.currency(quote!['cashKzt'] ?? 0)),
            ),
            FilledButton(
              onPressed: loading ? null : checkout,
              child: Text(l.pay),
            ),
          ],
          if (result != null)
            ListTile(
              leading: const Icon(Icons.schedule),
              title: Text(l.paymentPending),
              subtitle: Text(result!),
            ),
        ],
      ),
    );
  }
}

class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});
  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ApiPageState<CheckoutScreen> {
  Map<String, dynamic>? household;
  Map<String, dynamic>? quote;
  final promo = TextEditingController();
  final bonuses = TextEditingController(text: '0');
  bool autoRenew = false;
  String? result;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    try {
      final v = await ref.read(legacy.apiProvider).call('GET', '/household');
      if (mounted) {
        setState(() {
          household = v;
          loading = false;
        });
      }
    } catch (e) {
      fail(e);
    }
  }

  Future<void> calculate() async {
    final members = household?['members'] as List<dynamic>? ?? [];
    final addresses = household?['addresses'] as List<dynamic>? ?? [];
    if (members.isEmpty || addresses.isEmpty) {
      fail('Complete family and address first');
      return;
    }
    beginLoad();
    try {
      final start = DateFormat('yyyy-MM-dd')
          .format(DateTime.now().add(const Duration(days: 2)));
      final v = await ref
          .read(legacy.apiProvider)
          .call(
            'POST',
            '/subscriptions/quotes',
            body: {
              'addressId': addresses.first['id'],
              'startDate': start,
              'memberIds': members.map((m) => m['id']).toList(),
              'bonusKzt': int.tryParse(bonuses.text) ?? 0,
              'guestDays': 0,
              if (promo.text.trim().isNotEmpty) 'promoCode': promo.text.trim(),
            },
          );
      if (mounted) {
        setState(() {
          quote = v;
          loading = false;
          error = null;
        });
      }
    } catch (e) {
      fail(e);
    }
  }

  Future<void> pay() async {
    beginLoad();
    try {
      final v = await ref
          .read(legacy.apiProvider)
          .call(
            'POST',
            '/subscriptions/checkout',
            body: {
              'quoteId': quote!['id'],
              'idempotencyKey': 'mobile-checkout-${quote!['id']}',
              'autoRenew': autoRenew,
            },
          );
      if (mounted) {
        setState(() {
          result = '${v['status'] ?? 'PENDING'}';
          loading = false;
        });
      }
    } catch (e) {
      fail(e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.checkout)),
      body: AsyncStateView(
        loading: loading,
        error: error,
        onRetry: quote == null ? load : calculate,
        child: ListView(
          padding: const EdgeInsets.all(JantokSpace.md),
          children: [
            TextField(
              controller: promo,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(labelText: l.promoCode),
            ),
            const SizedBox(height: JantokSpace.sm),
            TextField(
              controller: bonuses,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(labelText: l.bonusesToSpend),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(l.autoRenew),
              value: autoRenew,
              onChanged: (v) => setState(() => autoRenew = v),
            ),
            FilledButton.tonal(onPressed: calculate, child: Text(l.quote)),
            if (quote != null) ...[
              const SizedBox(height: JantokSpace.lg),
              ...((quote!['lines'] as List<dynamic>? ?? []).map(
                (raw) => ListTile(
                  title: Text('${raw['description']}'),
                  trailing: Text(l.currency(raw['totalKzt'])),
                ),
              )),
              ListTile(
                title: Text(
                  l.total,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                trailing: Text(
                  l.currency(quote!['cashKzt']),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              FilledButton(onPressed: pay, child: Text(l.pay)),
            ],
            if (result != null)
              Card(
                child: ListTile(
                  leading: const CircularProgressIndicator(),
                  title: Text(l.paymentPending),
                  subtitle: Text(result!),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class PaymentsScreen extends ConsumerStatefulWidget {
  const PaymentsScreen({super.key});
  @override
  ConsumerState<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends ApiPageState<PaymentsScreen> {
  List<dynamic> history = [], methods = [];
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    if (!loading) beginLoad();
    try {
      final api = ref.read(legacy.apiProvider);
      final values = await Future.wait([
        api.callList('GET', '/payments/history'),
        api.callList('GET', '/payments/methods'),
      ]);
      if (mounted) {
        setState(() {
          history = values[0];
          methods = values[1];
          loading = false;
        });
      }
    } catch (e) {
      fail(e);
    }
  }

  Future<void> requestRefund(Map<String, dynamic> purchase) async {
    final l = AppLocalizations.of(context);
    final reason = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.refund),
        content: TextField(
          controller: reason,
          minLines: 2,
          maxLines: 4,
          decoration: InputDecoration(labelText: l.refundReason),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(l.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(l.refund),
          ),
        ],
      ),
    );
    if (confirmed != true || reason.text.trim().length < 3) return;
    beginLoad();
    try {
      await ref
          .read(legacy.apiProvider)
          .call(
            'POST',
            '/payments/refunds',
            body: {
              'purchaseId': purchase['id'],
              'idempotencyKey': 'mobile-refund-${purchase['id']}',
              'reason': reason.text.trim(),
            },
          );
      await load();
    } catch (caught) {
      fail(caught);
    }
  }

  Future<void> showPayment(Map<String, dynamic> purchase) async {
    final l = AppLocalizations.of(context);
    final receipts = purchase['receipts'] as List<dynamic>? ?? const [];
    final refunds = purchase['refunds'] as List<dynamic>? ?? const [];
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(JantokSpace.md),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l.currency(purchase['cashKzt'] ?? 0),
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              Text('${purchase['status']} · ${purchase['createdAt'] ?? ''}'),
              const SizedBox(height: JantokSpace.sm),
              Text('${l.receipts}: ${receipts.length}'),
              Text('${l.refunds}: ${refunds.length}'),
              const SizedBox(height: JantokSpace.md),
              if (purchase['status'] == 'CAPTURED')
                FilledButton.tonalIcon(
                  onPressed: () {
                    Navigator.pop(sheetContext);
                    requestRefund(purchase);
                  },
                  icon: const Icon(Icons.undo),
                  label: Text(l.refund),
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.payments)),
      body: AsyncStateView(
        loading: loading,
        error: error,
        onRetry: load,
        child: RefreshIndicator(
          onRefresh: load,
          child: ListView(
            padding: const EdgeInsets.all(JantokSpace.md),
            children: [
              Text(
                l.savedMethods,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              if (methods.isEmpty) Text(l.empty),
              ...methods.map(
                (m) => ListTile(
                  leading: const Icon(Icons.credit_card),
                  title: Text(
                    '${m['brand'] ?? 'Card'} •••• ${m['last4'] ?? ''}',
                  ),
                  subtitle: Text(m['mandateActive'] == true ? l.autoRenew : ''),
                ),
              ),
              const Divider(),
              Text(
                l.paymentHistory,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              if (history.isEmpty) Text(l.empty),
              ...history.map((raw) {
                final p = raw as Map<String, dynamic>;
                return Card(
                  child: ListTile(
                    title: Text(l.currency(p['cashKzt'] ?? 0)),
                    subtitle: Text('${p['status']} · ${p['createdAt'] ?? ''}'),
                    trailing: const Icon(Icons.receipt_long),
                    onTap: () => showPayment(p),
                  ),
                );
              }),
            ],
          ),
        ),
      ),
    );
  }
}

class AddonsScreen extends ConsumerStatefulWidget {
  const AddonsScreen({super.key});
  @override
  ConsumerState<AddonsScreen> createState() => _AddonsScreenState();
}

class _AddonsScreenState extends ApiPageState<AddonsScreen> {
  List<dynamic> items = [];
  Map<String, dynamic>? subscription;
  Map<String, dynamic>? household;
  String? operationStatus;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    if (!loading) beginLoad();
    try {
      final api = ref.read(legacy.apiProvider);
      final values = await Future.wait([
        api.callList('GET', '/loyalty/addons'),
        api.call('GET', '/subscriptions/current'),
        api.call('GET', '/household'),
      ]);
      if (mounted) {
        setState(() {
          items = values[0] as List<dynamic>;
          subscription = values[1] as Map<String, dynamic>;
          household = values[2] as Map<String, dynamic>;
          loading = false;
        });
      }
    } catch (e) {
      fail(e);
    }
  }

  Future<void> buy(Map<String, dynamic> addon) async {
    final l = AppLocalizations.of(context);
    var quantity = 1;
    var recurring = false;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('${addon['nameRu'] ?? addon['code']}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<int>(
                initialValue: quantity,
                decoration: InputDecoration(labelText: l.quantity),
                items: [1, 2, 3]
                    .map(
                      (value) => DropdownMenuItem(
                        value: value,
                        child: Text('×$value'),
                      ),
                    )
                    .toList(),
                onChanged: (value) =>
                    setDialogState(() => quantity = value ?? 1),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l.recurringAddon),
                value: recurring,
                onChanged: (value) => setDialogState(() => recurring = value),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(l.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(l.pay),
            ),
          ],
        ),
      ),
    );
    if (accepted != true) return;
    final members = household?['members'] as List<dynamic>? ?? const [];
    final days = subscription?['serviceDays'] as List<dynamic>? ?? const [];
    final planned = days.where((day) => day['status'] == 'PLANNED').firstOrNull;
    if (subscription == null ||
        subscription!.isEmpty ||
        members.isEmpty ||
        planned == null) {
      fail(l.noSubscription);
      return;
    }
    beginLoad();
    try {
      final api = ref.read(legacy.apiProvider);
      Map<String, dynamic> value;
      if (recurring) {
        value = await api.call(
          'POST',
          '/payments/addons/recurring',
          body: {
            'subscriptionId': subscription!['id'],
            'addonId': addon['id'],
            'quantityPerDay': quantity,
            'bonusKzt': 0,
            'idempotencyKey':
                'mobile-addon-recurring-${subscription!['id']}-${addon['id']}-$quantity',
          },
        );
      } else {
        final date = '${planned['serviceDate']}'.split('T').first;
        final quote = await api.call(
          'POST',
          '/subscriptions/${subscription!['id']}/standalone-addon-quotes',
          body: {
            'memberId': members.first['id'],
            'addonId': addon['id'],
            'serviceDate': date,
            'quantity': quantity,
            'bonusKzt': 0,
          },
        );
        value = await api.call(
          'POST',
          '/subscriptions/${subscription!['id']}/change-checkout',
          body: {
            'quoteId': quote['id'],
            'idempotencyKey': 'mobile-addon-${quote['id']}',
          },
        );
      }
      if (mounted) {
        setState(() {
          operationStatus = '${value['status'] ?? 'PENDING'}';
          loading = false;
          error = null;
        });
      }
    } catch (caught) {
      fail(caught);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.addons)),
      body: AsyncStateView(
        loading: loading,
        error: error,
        onRetry: load,
        child: ListView(
          padding: const EdgeInsets.all(JantokSpace.md),
          children: [
            if (operationStatus != null)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.schedule),
                  title: Text(l.paymentPending),
                  subtitle: Text(operationStatus!),
                ),
              ),
            if (items.isEmpty) Text(l.empty),
            ...items.map((raw) {
              final a = raw as Map<String, dynamic>;
              return Card(
                child: ListTile(
                  leading: const Icon(Icons.add_circle_outline),
                  title: Text('${a['nameRu'] ?? a['code']}'),
                  subtitle: Text(
                    '${a['category']?['nameRu'] ?? ''} · stock ${a['stockUnits']}',
                  ),
                  trailing: Text(l.currency(a['standalonePriceKzt'])),
                  onTap: () => buy(a),
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}

class SupportScreen extends ConsumerStatefulWidget {
  const SupportScreen({super.key});
  @override
  ConsumerState<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends ApiPageState<SupportScreen> {
  List<dynamic> threads = [];
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    if (!loading) beginLoad();
    try {
      final v = await ref
          .read(legacy.apiProvider)
          .callList('GET', '/support/threads');
      if (mounted) {
        setState(() {
          threads = v;
          loading = false;
        });
      }
    } catch (e) {
      fail(e);
    }
  }

  Future<void> create() async {
    final controller = TextEditingController();
    XFile? photo;
    final value = await showDialog<String>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(AppLocalizations.of(context).newRequest),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: controller, minLines: 3, maxLines: 6),
              const SizedBox(height: JantokSpace.sm),
              OutlinedButton.icon(
                onPressed: () async {
                  final selected = await ImagePicker().pickImage(
                    source: ImageSource.gallery,
                    imageQuality: 85,
                  );
                  if (selected != null) setDialogState(() => photo = selected);
                },
                icon: const Icon(Icons.add_photo_alternate_outlined),
                label: Text(
                  photo == null
                      ? AppLocalizations.of(context).attachPhoto
                      : AppLocalizations.of(context).photoReady,
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(AppLocalizations.of(context).cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, controller.text.trim()),
              child: Text(AppLocalizations.of(context).save),
            ),
          ],
        ),
      ),
    );
    if (value == null || value.isEmpty) return;
    final attachment = photo == null
        ? null
        : await ref.read(legacy.apiProvider).uploadSupportPhoto(photo!);
    await ref
        .read(legacy.apiProvider)
        .call(
          'POST',
          '/support/threads',
          body: {
            'reason': 'OTHER',
            'subject': value.length > 80 ? value.substring(0, 80) : value,
            'body': value,
            'clientMessageId':
                'mobile-${DateTime.now().microsecondsSinceEpoch}',
            'attachments': attachment == null ? [] : [attachment],
          },
        );
    await load();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.support)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: create,
        icon: const Icon(Icons.add),
        label: Text(l.newRequest),
      ),
      body: AsyncStateView(
        loading: loading,
        error: error,
        onRetry: load,
        child: ListView(
          padding: const EdgeInsets.all(JantokSpace.md),
          children: [
            if (threads.isEmpty) Text(l.empty),
            ...threads.map(
              (t) => Card(
                child: ListTile(
                  leading: const Icon(Icons.chat_bubble_outline),
                  title: Text('${t['subject']}'),
                  subtitle: Text(
                    '${t['status']} · unread ${t['customerUnreadCount'] ?? 0}',
                  ),
                  onTap: () => _push(
                    context,
                    SupportThreadScreen(
                      threadId: '${t['id']}',
                      title: '${t['subject']}',
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class SupportThreadScreen extends ConsumerStatefulWidget {
  const SupportThreadScreen({
    super.key,
    required this.threadId,
    required this.title,
  });
  final String threadId, title;
  @override
  ConsumerState<SupportThreadScreen> createState() =>
      _SupportThreadScreenState();
}

class _SupportThreadScreenState extends ApiPageState<SupportThreadScreen> {
  List<dynamic> messages = [];
  final text = TextEditingController();
  XFile? photo;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    try {
      final v = await ref
          .read(legacy.apiProvider)
          .callList('GET', '/support/threads/${widget.threadId}/messages');
      await ref
          .read(legacy.apiProvider)
          .call('POST', '/support/threads/${widget.threadId}/read');
      if (mounted) {
        setState(() {
          messages = v;
          loading = false;
          error = null;
        });
      }
    } catch (e) {
      fail(e);
    }
  }

  Future<void> send() async {
    final body = text.text.trim();
    if (body.isEmpty) return;
    final attachment = photo == null
        ? null
        : await ref.read(legacy.apiProvider).uploadSupportPhoto(photo!);
    text.clear();
    photo = null;
    await ref
        .read(legacy.apiProvider)
        .call(
          'POST',
          '/support/threads/${widget.threadId}/messages',
          body: {
            'body': body,
            'clientMessageId':
                'mobile-${DateTime.now().microsecondsSinceEpoch}',
            'attachments': attachment == null ? [] : [attachment],
          },
        );
    await load();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(widget.title)),
    body: AsyncStateView(
      loading: loading,
      error: error,
      onRetry: load,
      child: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(JantokSpace.md),
              children: messages
                  .map(
                    (m) => Align(
                      alignment: m['senderType'] == 'CUSTOMER'
                          ? Alignment.centerRight
                          : Alignment.centerLeft,
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.all(JantokSpace.sm),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${m['body']}'),
                              if ((m['attachments'] as List<dynamic>? ?? [])
                                  .isNotEmpty)
                                const Padding(
                                  padding: EdgeInsets.only(top: JantokSpace.xs),
                                  child: Icon(Icons.image_outlined),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(JantokSpace.sm),
              child: Row(
                children: [
                  IconButton(
                    tooltip: AppLocalizations.of(context).attachPhoto,
                    onPressed: () async {
                      final selected = await ImagePicker().pickImage(
                        source: ImageSource.gallery,
                        imageQuality: 85,
                      );
                      if (selected != null && mounted) {
                        setState(() => photo = selected);
                      }
                    },
                    icon: Icon(
                      photo == null
                          ? Icons.add_photo_alternate_outlined
                          : Icons.image,
                    ),
                  ),
                  Expanded(
                    child: TextField(
                      controller: text,
                      decoration: const InputDecoration(
                        hintText: 'Message / Хабарлама / Сообщение',
                      ),
                    ),
                  ),
                  IconButton(onPressed: send, icon: const Icon(Icons.send)),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class ReviewsScreen extends ConsumerStatefulWidget {
  const ReviewsScreen({super.key});
  @override
  ConsumerState<ReviewsScreen> createState() => _ReviewsScreenState();
}

class _ReviewsScreenState extends ApiPageState<ReviewsScreen> {
  List<dynamic> reviews = [];
  List<Map<String, dynamic>> deliveredLines = [];
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    if (!loading) beginLoad();
    try {
      final api = ref.read(legacy.apiProvider);
      final values = await Future.wait([
        api.callList('GET', '/reviews'),
        api.call('GET', '/subscriptions/current'),
      ]);
      final subscription = values[1] as Map<String, dynamic>;
      final orders = subscription['dailyOrders'] as List<dynamic>? ?? const [];
      final lines = <Map<String, dynamic>>[];
      for (final rawOrder in orders) {
        final order = rawOrder as Map<String, dynamic>;
        if (order['status'] != 'DELIVERED') continue;
        for (final rawLine in order['lines'] as List<dynamic>? ?? const []) {
          final line = rawLine as Map<String, dynamic>;
          lines.add({...line, 'serviceDate': order['serviceDate']});
        }
      }
      if (mounted) {
        setState(() {
          reviews = values[0] as List<dynamic>;
          deliveredLines = lines;
          loading = false;
        });
      }
    } catch (e) {
      fail(e);
    }
  }

  Future<void> remove(String id) async {
    await ref.read(legacy.apiProvider).call('DELETE', '/reviews/$id');
    await load();
  }

  Future<void> createReview() async {
    final l = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    if (deliveredLines.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(l.noDeliveredMeals)));
      return;
    }
    var selected = deliveredLines.first;
    var rating = 5;
    final comment = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(l.createReview),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: '${selected['id']}',
                decoration: InputDecoration(labelText: l.mealDetails),
                items: deliveredLines.map((line) {
                  final meal = line['mealSnapshot'] as Map<String, dynamic>;
                  return DropdownMenuItem(
                    value: '${line['id']}',
                    child: Text('${meal['code']} · ${line['serviceDate']}'),
                  );
                }).toList(),
                onChanged: (id) => setDialogState(
                  () => selected = deliveredLines.firstWhere(
                    (line) => '${line['id']}' == id,
                  ),
                ),
              ),
              const SizedBox(height: JantokSpace.sm),
              DropdownButtonFormField<int>(
                initialValue: rating,
                decoration: InputDecoration(labelText: l.rating),
                items: [5, 4, 3, 2, 1]
                    .map(
                      (value) => DropdownMenuItem(
                        value: value,
                        child: Text('$value ★'),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setDialogState(() => rating = value ?? 5),
              ),
              const SizedBox(height: JantokSpace.sm),
              TextField(
                controller: comment,
                minLines: 2,
                maxLines: 4,
                decoration: InputDecoration(labelText: l.comment),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(l.cancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(l.save),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;
    final meal = selected['mealSnapshot'] as Map<String, dynamic>;
    beginLoad();
    try {
      await ref
          .read(legacy.apiProvider)
          .call(
            'POST',
            '/meals/${meal['id']}/reviews',
            body: {
              'dailyOrderLineId': selected['id'],
              'rating': rating,
              if (comment.text.trim().isNotEmpty)
                'comment': comment.text.trim(),
              'locale': locale,
            },
          );
      await load();
    } catch (caught) {
      fail(caught);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.myReviews)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: createReview,
        icon: const Icon(Icons.rate_review_outlined),
        label: Text(l.createReview),
      ),
      body: AsyncStateView(
        loading: loading,
        error: error,
        onRetry: load,
        child: ListView(
          padding: const EdgeInsets.all(JantokSpace.md),
          children: [
            if (reviews.isEmpty) Text(l.empty),
            ...reviews.map(
              (r) => Card(
                child: ListTile(
                  title: Text('${r['rating']} ★ · ${r['mealName']}'),
                  subtitle: Text('${r['comment'] ?? ''}'),
                  trailing: IconButton(
                    onPressed: () => remove('${r['id']}'),
                    icon: const Icon(Icons.delete_outline),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class SessionsScreen extends ConsumerStatefulWidget {
  const SessionsScreen({super.key});
  @override
  ConsumerState<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends ApiPageState<SessionsScreen> {
  List<dynamic> sessions = [];
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  Future<void> load() async {
    try {
      final v = await ref
          .read(legacy.apiProvider)
          .callList('GET', '/auth/sessions');
      if (mounted) {
        setState(() {
          sessions = v;
          loading = false;
        });
      }
    } catch (e) {
      fail(e);
    }
  }

  Future<void> revoke(String id) async {
    await ref.read(legacy.apiProvider).call('DELETE', '/auth/sessions/$id');
    await load();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(AppLocalizations.of(context).sessions)),
    body: AsyncStateView(
      loading: loading,
      error: error,
      onRetry: load,
      child: ListView(
        children: sessions
            .map(
              (s) => ListTile(
                leading: const Icon(Icons.phone_android),
                title: Text('${s['deviceName'] ?? 'Device'}'),
                subtitle: Text('${s['lastSeenAt']}'),
                trailing: IconButton(
                  onPressed: () => revoke('${s['id']}'),
                  icon: const Icon(Icons.logout),
                ),
              ),
            )
            .toList(),
      ),
    ),
  );
}

class _ActionCard extends StatelessWidget {
  const _ActionCard(this.icon, this.label, this.onTap);
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Card(
    child: InkWell(
      borderRadius: BorderRadius.circular(JantokRadius.card),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(JantokSpace.sm),
        child: Row(
          children: [
            Icon(icon),
            const SizedBox(width: 8),
            Expanded(child: Text(label)),
          ],
        ),
      ),
    ),
  );
}

class _NavTile extends StatelessWidget {
  const _NavTile(this.icon, this.label, this.onTap);
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Card(
    child: ListTile(
      leading: Icon(icon),
      title: Text(label),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    ),
  );
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
    constraints: const BoxConstraints(minWidth: 112),
    padding: const EdgeInsets.all(JantokSpace.sm),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(JantokRadius.field),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.labelMedium),
        Text(value, style: Theme.of(context).textTheme.titleMedium),
      ],
    ),
  );
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(JantokSpace.lg),
      child: Row(
        children: [
          Icon(icon),
          const SizedBox(width: 12),
          Expanded(child: Text(text)),
        ],
      ),
    ),
  );
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});
  final String title;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: JantokSpace.lg),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: JantokSpace.xs),
        ...children,
      ],
    ),
  );
}

Future<T?> _push<T>(BuildContext context, Widget screen) =>
    Navigator.of(context).push<T>(MaterialPageRoute(builder: (_) => screen));
String _translated(dynamic raw, String locale, String fallback) {
  final items = raw is List
      ? raw.cast<Map<String, dynamic>>()
      : <Map<String, dynamic>>[];
  Map<String, dynamic>? match = items
      .where((t) => t['locale'] == locale)
      .firstOrNull;
  match ??= items.where((t) => t['locale'] == 'kk').firstOrNull;
  match ??= items.where((t) => t['locale'] == 'ru').firstOrNull;
  return '${match?['name'] ?? fallback}';
}

String _mealType(BuildContext context, String value) {
  final l = AppLocalizations.of(context);
  return switch (value) {
    'BREAKFAST' => l.breakfast,
    'LUNCH' => l.lunch,
    'DINNER' => l.dinner,
    _ => value,
  };
}
