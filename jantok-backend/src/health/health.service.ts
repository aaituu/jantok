import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async checkReadiness() {
    const redisUrl = process.env.REDIS_URL;
    const s3Endpoint = process.env.S3_ENDPOINT;
    const s3Bucket = process.env.S3_BUCKET;
    const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
    const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    if (
      !redisUrl ||
      !s3Endpoint ||
      !s3Bucket ||
      !s3AccessKeyId ||
      !s3SecretAccessKey
    ) {
      throw new ServiceUnavailableException(
        'Dependency configuration is missing',
      );
    }
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    });
    const storage = new S3Client({
      endpoint: s3Endpoint,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
      },
    });

    try {
      await Promise.all([
        this.prisma.$queryRaw`SELECT 1`,
        redis.connect(),
        storage.send(new HeadBucketCommand({ Bucket: s3Bucket })),
      ]);
      await redis.ping();
      return {
        status: 'ok',
        checks: { postgres: 'up', redis: 'up', storage: 'up' },
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException(
        'A required dependency is unavailable',
      );
    } finally {
      redis.disconnect();
      storage.destroy();
    }
  }
}
