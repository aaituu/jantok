import { createHash } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PushProvider, type PushMessage } from './push-provider.js';

@Injectable()
export class LocalPushProvider extends PushProvider {
  readonly name = 'LOCAL_PUSH_SIMULATOR';

  async send(message: PushMessage) {
    if (process.env.APP_ENV === 'production')
      throw new ServiceUnavailableException({
        code: 'PUSH_PROVIDER_NOT_CONFIGURED',
        message: 'A production push provider has not been selected',
      });
    return {
      providerMessageId: `push_sim_${createHash('sha256').update(message.idempotencyKey).digest('hex').slice(0, 24)}`,
      acceptedAt: new Date(),
    };
  }
}
