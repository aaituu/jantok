import { Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { NestFactory } from '@nestjs/core';
import { PaymentService } from './modules/payments/payment.service.js';
import { DeliveryService } from './modules/delivery/delivery.service.js';
import { AppModule } from './app.module.js';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL is required');
}

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue('system', { connection });
await queue.upsertJobScheduler(
  'payments-maintenance',
  {
    every:
      Number(process.env.PAYMENT_MAINTENANCE_INTERVAL_SECONDS ?? '60') * 1000,
  },
  { name: 'payments.maintenance', data: {} },
);
await queue.upsertJobScheduler(
  'delivery-maintenance',
  {
    every:
      Number(process.env.DELIVERY_MAINTENANCE_INTERVAL_SECONDS ?? '60') * 1000,
  },
  { name: 'deliveries.maintenance', data: {} },
);
const application = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const payments = application.get(PaymentService);
const deliveries = application.get(DeliveryService);

const worker = new Worker(
  'system',
  async (job: Job) => {
    if (job.name === 'healthcheck')
      return { processedAt: new Date().toISOString(), input: job.data };
    if (job.name === 'payments.maintenance') return payments.runMaintenance();
    if (job.name === 'payments.reconcile')
      return payments.reconcilePurchase(String(job.data.purchaseId));
    if (job.name === 'payments.renewal')
      return payments.processRenewal(String(job.data.renewalJobId));
    if (job.name === 'deliveries.maintenance')
      return deliveries.runMaintenance();
    if (job.name === 'deliveries.dispatch')
      return deliveries.processJob(String(job.data.deliveryJobId));
    throw new Error(`Unsupported system job: ${job.name}`);
  },
  { connection },
);

worker.on('ready', () => {
  process.stdout.write(
    `${JSON.stringify({ level: 'info', event: 'worker.ready' })}\n`,
  );
});
worker.on('failed', (job, error) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'error', event: 'worker.job_failed', jobId: job?.id, message: error.message })}\n`,
  );
});

async function shutdown(signal: string) {
  process.stdout.write(
    `${JSON.stringify({ level: 'info', event: 'worker.shutdown', signal })}\n`,
  );
  await worker.close();
  await queue.close();
  await application.close();
  connection.disconnect();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
