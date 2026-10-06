export type PushMessage = {
  userId: string;
  title: string;
  body: string;
  payload: Record<string, string>;
  idempotencyKey: string;
};

export type PushResult = {
  providerMessageId: string;
  acceptedAt: Date;
};

export abstract class PushProvider {
  abstract readonly name: string;
  abstract send(message: PushMessage): Promise<PushResult>;
}
