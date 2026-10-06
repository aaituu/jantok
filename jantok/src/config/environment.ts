type Environment = 'local' | 'test' | 'staging' | 'production';

const allowedEnvironments = new Set<Environment>([
  'local',
  'test',
  'staging',
  'production',
]);

export function validateEnvironment(config: Record<string, unknown>) {
  const appEnv = String(config.APP_ENV ?? 'local') as Environment;
  if (!allowedEnvironments.has(appEnv)) {
    throw new Error('APP_ENV must be local, test, staging, or production');
  }

  for (const name of ['DATABASE_URL', 'REDIS_URL', 'S3_ENDPOINT']) {
    const value = config[name];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${name} is required`);
    }
    try {
      new URL(value);
    } catch {
      throw new Error(`${name} must be a valid URL`);
    }
  }

  for (const name of [
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ]) {
    if (typeof config[name] !== 'string' || config[name].length === 0) {
      throw new Error(`${name} is required`);
    }
  }

  const requiredSecrets = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'SESSION_SECRET',
    'OTP_HASH_SECRET',
    'PII_ENCRYPTION_KEY',
  ];
  for (const name of requiredSecrets) {
    if (typeof config[name] !== 'string' || config[name].length < 32) {
      throw new Error(`${name} must contain at least 32 characters`);
    }
  }
  if (!/^[0-9a-fA-F]{64}$/.test(String(config.PII_ENCRYPTION_KEY))) {
    throw new Error(
      'PII_ENCRYPTION_KEY must be exactly 32 bytes encoded as 64 hex characters',
    );
  }
  const numericPolicies: Array<[string, number, number]> = [
    ['JWT_ACCESS_TTL_SECONDS', 60, 86400],
    ['JWT_REFRESH_TTL_SECONDS', 3600, 31536000],
    ['OTP_CODE_LENGTH', 6, 8],
    ['OTP_TTL_SECONDS', 30, 1800],
    ['OTP_RESEND_SECONDS', 10, 1800],
    ['OTP_MAX_ATTEMPTS', 1, 20],
    ['OTP_RATE_LIMIT_WINDOW_SECONDS', 60, 86400],
    ['OTP_RATE_LIMIT_PER_PHONE', 1, 100],
    ['OTP_RATE_LIMIT_PER_IP', 1, 1000],
    ['OTP_RATE_LIMIT_PER_DEVICE', 1, 100],
  ];
  for (const [name, minimum, maximum] of numericPolicies) {
    const value = Number(config[name]);
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      throw new Error(
        `${name} must be an integer from ${minimum} to ${maximum}`,
      );
  }
  const maintenanceInterval = Number(
    config.PAYMENT_MAINTENANCE_INTERVAL_SECONDS ?? 60,
  );
  if (
    !Number.isInteger(maintenanceInterval) ||
    maintenanceInterval < 10 ||
    maintenanceInterval > 3600
  )
    throw new Error(
      'PAYMENT_MAINTENANCE_INTERVAL_SECONDS must be an integer from 10 to 3600',
    );
  const deliveryMaintenanceInterval = Number(
    config.DELIVERY_MAINTENANCE_INTERVAL_SECONDS ?? 60,
  );
  if (
    !Number.isInteger(deliveryMaintenanceInterval) ||
    deliveryMaintenanceInterval < 10 ||
    deliveryMaintenanceInterval > 3600
  )
    throw new Error(
      'DELIVERY_MAINTENANCE_INTERVAL_SECONDS must be an integer from 10 to 3600',
    );
  if (
    !['local', 'unconfigured'].includes(
      String(config.OTP_PROVIDER_MODE ?? 'local'),
    )
  )
    throw new Error('OTP_PROVIDER_MODE must be local or unconfigured');
  if (appEnv === 'production' && config.OTP_PROVIDER_MODE !== 'unconfigured') {
    throw new Error('OTP_PROVIDER_MODE=local is forbidden in production');
  }
  for (const name of ['PAYMENT_PROVIDER_MODE', 'FISCALIZATION_PROVIDER_MODE']) {
    if (!['local', 'unconfigured'].includes(String(config[name] ?? 'local')))
      throw new Error(`${name} must be local or unconfigured`);
    if (appEnv === 'production' && config[name] !== 'unconfigured')
      throw new Error(`${name}=local is forbidden in production`);
  }
  if (
    !['local', 'unconfigured'].includes(
      String(config.DELIVERY_PROVIDER_MODE ?? 'local'),
    )
  )
    throw new Error('DELIVERY_PROVIDER_MODE must be local or unconfigured');
  if (
    appEnv === 'production' &&
    config.DELIVERY_PROVIDER_MODE !== 'unconfigured'
  )
    throw new Error('DELIVERY_PROVIDER_MODE=local is forbidden in production');
  if (
    !['local', 'unconfigured'].includes(
      String(config.PUSH_PROVIDER_MODE ?? 'local'),
    )
  )
    throw new Error('PUSH_PROVIDER_MODE must be local or unconfigured');
  if (appEnv === 'production' && config.PUSH_PROVIDER_MODE !== 'unconfigured')
    throw new Error('PUSH_PROVIDER_MODE=local is forbidden in production');
  if (
    (config.DELIVERY_PROVIDER_MODE ?? 'local') === 'local' &&
    (typeof config.DELIVERY_SIMULATOR_WEBHOOK_SECRET !== 'string' ||
      config.DELIVERY_SIMULATOR_WEBHOOK_SECRET.length < 32)
  )
    throw new Error(
      'DELIVERY_SIMULATOR_WEBHOOK_SECRET must contain at least 32 characters',
    );
  if (
    (config.PAYMENT_PROVIDER_MODE ?? 'local') === 'local' &&
    (typeof config.PAYMENT_SIMULATOR_WEBHOOK_SECRET !== 'string' ||
      config.PAYMENT_SIMULATOR_WEBHOOK_SECRET.length < 32)
  )
    throw new Error(
      'PAYMENT_SIMULATOR_WEBHOOK_SECRET must contain at least 32 characters',
    );
  if (appEnv === 'production') {
    if (String(config.DEMO_SEED_ENABLED ?? 'false').toLowerCase() === 'true')
      throw new Error('DEMO_SEED_ENABLED=true is forbidden in production');
    const forbiddenDefaults = new Set([
      'local-access-secret-change-before-deploy-32-bytes',
      'local-refresh-secret-change-before-deploy-32-bytes',
      'local-session-secret-change-before-deploy-32-bytes',
      'local-otp-hash-secret-change-before-deploy-32-bytes',
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    ]);
    if (
      requiredSecrets.some((name) =>
        forbiddenDefaults.has(String(config[name])),
      )
    )
      throw new Error('Local development secrets are forbidden in production');
    const admins = [config.SUPER_ADMIN_PHONE_1, config.SUPER_ADMIN_PHONE_2];
    if (
      admins.some(
        (phone) =>
          typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phone),
      ) ||
      admins[0] === admins[1]
    ) {
      throw new Error(
        'Two distinct E.164 SUPER_ADMIN_PHONE values are required in production',
      );
    }
  }

  return { ...config, APP_ENV: appEnv };
}
