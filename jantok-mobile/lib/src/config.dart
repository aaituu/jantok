import 'dart:io';

enum AppEnvironment { dev, staging, production }

abstract final class AppConfig {
  static const environmentName = String.fromEnvironment(
    'APP_ENV',
    defaultValue: 'dev',
  );
  static const configuredBaseUrl = String.fromEnvironment('API_BASE_URL');
  static const checkoutReturnScheme = 'jantok';
  static const checkoutReturnHost = 'payment-return';

  static AppEnvironment get environment => switch (environmentName) {
    'production' => AppEnvironment.production,
    'staging' => AppEnvironment.staging,
    _ => AppEnvironment.dev,
  };

  static String get apiBaseUrl {
    final value = configuredBaseUrl.isNotEmpty
        ? configuredBaseUrl
        : environment == AppEnvironment.dev
        ? 'http://${Platform.isAndroid ? '10.0.2.2' : 'localhost'}:8080/api/v1'
        : '';
    if (value.isEmpty) {
      throw StateError('API_BASE_URL is required outside the dev flavor.');
    }
    final uri = Uri.tryParse(value);
    if (uri == null || !uri.hasScheme || !uri.hasAuthority) {
      throw StateError('API_BASE_URL must be an absolute URL.');
    }
    if (environment != AppEnvironment.dev && uri.scheme != 'https') {
      throw StateError('Staging and production API_BASE_URL must use HTTPS.');
    }
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }
}
