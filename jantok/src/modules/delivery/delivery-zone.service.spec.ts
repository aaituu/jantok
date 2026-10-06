import { describe, expect, it } from 'vitest';
import { pointInPolygon } from './delivery-zone.service.js';

const polygon = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [0, 0],
      [4, 0],
      [3, 3],
      [1, 4],
      [0, 0],
    ] as [number, number][],
  ],
};

describe('delivery polygon', () => {
  it('accepts inside and boundary points', () => {
    expect(pointInPolygon([2, 2], polygon)).toBe(true);
    expect(pointInPolygon([0, 0], polygon)).toBe(true);
  });

  it('rejects a point outside the actual polygon but inside its bounding box', () => {
    expect(pointInPolygon([3.9, 3.9], polygon)).toBe(false);
  });
});
