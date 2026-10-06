import { createHash } from 'node:crypto';

export const stableJson = (value: unknown): string => {
  if (Array.isArray(value))
    return `[${value.map(stableJson).sort().join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

export const productionVariantKey = (value: unknown) =>
  createHash('sha256').update(stableJson(value)).digest('hex');
