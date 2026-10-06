import { describe, expect, it } from 'vitest';
import { almatyDeadline, cutoffDecision } from './cutoff.service.js';

describe('strict Asia/Almaty cutoffs', () => {
  const serviceDate = '2026-09-24';
  const boundary = almatyDeadline(serviceDate, 13 * 60);

  it('accepts one millisecond before the boundary', () => {
    expect(
      cutoffDecision(serviceDate, 13 * 60, new Date(boundary.getTime() - 1))
        .allowed,
    ).toBe(true);
  });

  it('rejects exactly at the boundary', () => {
    expect(cutoffDecision(serviceDate, 13 * 60, boundary).allowed).toBe(false);
  });

  it('rejects after the boundary and reports the next date', () => {
    const result = cutoffDecision(
      serviceDate,
      13 * 60,
      new Date(boundary.getTime() + 1),
    );
    expect(result.allowed).toBe(false);
    expect(result.nextEligibleDate).toBe('2026-09-25');
    expect(boundary.toISOString()).toBe('2026-09-23T08:00:00.000Z');
  });

  it.each([
    ['menu', 13 * 60],
    ['payment', 13 * 60],
    ['skip', 14 * 60],
    ['pause-nearest-day', 14 * 60],
    ['address', 14 * 60],
    ['standalone-addon', 15 * 60],
    ['kitchen-lock', 15 * 60 + 5],
  ])('%s is open only strictly before its boundary', (_name, minutes) => {
    const edge = almatyDeadline(serviceDate, minutes as number);
    expect(
      cutoffDecision(
        serviceDate,
        minutes as number,
        new Date(edge.getTime() - 1),
      ).allowed,
    ).toBe(true);
    expect(cutoffDecision(serviceDate, minutes as number, edge).allowed).toBe(
      false,
    );
    expect(
      cutoffDecision(
        serviceDate,
        minutes as number,
        new Date(edge.getTime() + 1),
      ).allowed,
    ).toBe(false);
  });
});
