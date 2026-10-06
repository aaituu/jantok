import { validateEnvironment } from './environment.js';

const base = {
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'test',
  S3_ACCESS_KEY_ID: 'test',
  S3_SECRET_ACCESS_KEY: 'test',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  SESSION_SECRET: 'c'.repeat(32),
  OTP_HASH_SECRET: 'd'.repeat(32),
  PII_ENCRYPTION_KEY: '01'.repeat(32),
  JWT_ACCESS_TTL_SECONDS: '900',
  JWT_REFRESH_TTL_SECONDS: '2592000',
  OTP_CODE_LENGTH: '6',
  OTP_TTL_SECONDS: '300',
  OTP_RESEND_SECONDS: '60',
  OTP_MAX_ATTEMPTS: '5',
  OTP_RATE_LIMIT_WINDOW_SECONDS: '3600',
  OTP_RATE_LIMIT_PER_PHONE: '5',
  OTP_RATE_LIMIT_PER_IP: '20',
  OTP_RATE_LIMIT_PER_DEVICE: '10',
  PAYMENT_PROVIDER_MODE: 'unconfigured',
  FISCALIZATION_PROVIDER_MODE: 'unconfigured',
  DELIVERY_PROVIDER_MODE: 'unconfigured',
  PUSH_PROVIDER_MODE: 'unconfigured',
};

describe('environment safety', () => {
  it('rejects local OTP in production', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        APP_ENV: 'production',
        OTP_PROVIDER_MODE: 'local',
        SUPER_ADMIN_PHONE_1: '+77000000001',
        SUPER_ADMIN_PHONE_2: '+77000000002',
      }),
    ).toThrow('forbidden');
  });
  it.each([
    'PAYMENT_PROVIDER_MODE',
    'FISCALIZATION_PROVIDER_MODE',
    'DELIVERY_PROVIDER_MODE',
    'PUSH_PROVIDER_MODE',
  ])('rejects local %s in production', (name) => {
    expect(() =>
      validateEnvironment({
        ...base,
        APP_ENV: 'production',
        OTP_PROVIDER_MODE: 'unconfigured',
        [name]: 'local',
        PAYMENT_SIMULATOR_WEBHOOK_SECRET: 'p'.repeat(32),
        DELIVERY_SIMULATOR_WEBHOOK_SECRET: 'd'.repeat(32),
        SUPER_ADMIN_PHONE_1: '+77000000001',
        SUPER_ADMIN_PHONE_2: '+77000000002',
      }),
    ).toThrow('forbidden');
  });
  it('requires distinct production super administrators', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        APP_ENV: 'production',
        OTP_PROVIDER_MODE: 'unconfigured',
        SUPER_ADMIN_PHONE_1: '+77000000001',
        SUPER_ADMIN_PHONE_2: '+77000000001',
      }),
    ).toThrow('distinct');
  });
  it('rejects demo seed in production', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        APP_ENV: 'production',
        OTP_PROVIDER_MODE: 'unconfigured',
        DEMO_SEED_ENABLED: 'true',
        SUPER_ADMIN_PHONE_1: '+77000000001',
        SUPER_ADMIN_PHONE_2: '+77000000002',
      }),
    ).toThrow('DEMO_SEED_ENABLED=true is forbidden');
  });
  it('rejects an adapter mode that has no implementation', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        APP_ENV: 'staging',
        OTP_PROVIDER_MODE: 'invented-vendor',
      }),
    ).toThrow('local or unconfigured');
  });
});
