import { describe, expect, it } from 'vitest';
import { redactAuditValue } from './audit.service.js';

describe('audit redaction', () => {
  it('recursively removes payment and provider secrets', () => {
    expect(
      redactAuditValue({
        amountKzt: 1000,
        providerToken: 'opaque-secret',
        nested: { cvv: '123', last4: '4242' },
      }),
    ).toEqual({
      amountKzt: 1000,
      providerToken: '[REDACTED]',
      nested: { cvv: '[REDACTED]', last4: '4242' },
    });
  });
});
