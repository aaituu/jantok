import 'package:flutter/material.dart';

abstract final class JantokSpace {
  static const xxs = 4.0;
  static const xs = 8.0;
  static const sm = 12.0;
  static const md = 16.0;
  static const lg = 24.0;
  static const xl = 32.0;
}

abstract final class JantokRadius {
  static const field = 12.0;
  static const card = 20.0;
}

abstract final class JantokTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: Colors.teal,
      brightness: Brightness.light,
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      visualDensity: VisualDensity.standard,
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerLowest,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(JantokRadius.field),
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surfaceContainerLow,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(JantokRadius.card),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 72,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        backgroundColor: scheme.surfaceContainerLowest,
      ),
    );
  }
}

class JantokWordmark extends StatelessWidget {
  const JantokWordmark({super.key, this.compact = false});
  final bool compact;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'JANTOK',
    header: true,
    child: Text(
      'JANTOK',
      style: compact
          ? Theme.of(context).textTheme.titleLarge
                ?.copyWith(fontWeight: FontWeight.w800, letterSpacing: 1.4)
          : Theme.of(context).textTheme.displaySmall
                ?.copyWith(fontWeight: FontWeight.w800, letterSpacing: 2),
    ),
  );
}

class AsyncStateView extends StatelessWidget {
  const AsyncStateView({
    super.key,
    required this.loading,
    required this.error,
    required this.onRetry,
    required this.child,
  });
  final bool loading;
  final Object? error;
  final VoidCallback onRetry;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (error != null) {
      return Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(JantokSpace.lg),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.cloud_off_outlined,
                  size: 48,
                  color: Theme.of(context).colorScheme.error,
                ),
                const SizedBox(height: JantokSpace.md),
                Text(
                  '$error',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: JantokSpace.md),
                FilledButton.tonalIcon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Retry / Қайталау / Повторить'),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return child;
  }
}

class FoodPhotoFallback extends StatelessWidget {
  const FoodPhotoFallback({super.key, this.height = 180});
  final double height;

  @override
  Widget build(BuildContext context) => Semantics(
    image: true,
    label: 'Meal image unavailable',
    child: Container(
      height: height,
      width: double.infinity,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(JantokRadius.card),
      ),
      child: const Center(child: Icon(Icons.restaurant, size: 48)),
    ),
  );
}
