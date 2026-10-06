import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

if (!['local', 'test'].includes(process.env.APP_ENV ?? 'local')) {
  throw new Error('Demo seed is allowed only for APP_ENV=local or test');
}
if (String(process.env.DEMO_SEED_ENABLED ?? '').toLowerCase() !== 'true') {
  throw new Error('Set DEMO_SEED_ENABLED=true explicitly to run demo seed');
}

const application = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn', 'log'],
});
await application.close();
await new Promise<void>((resolve) => {
  process.stdout.write(
    `${JSON.stringify({ level: 'info', event: 'demo_seed.complete' })}\n`,
    () => resolve(),
  );
});

// BullMQ/Redis libraries can keep reconnect timers alive after Nest has closed.
// Seeding is a finite CLI command, so terminate only after all providers have
// completed their shutdown hooks and the completion record has been flushed.
process.exit(0);
