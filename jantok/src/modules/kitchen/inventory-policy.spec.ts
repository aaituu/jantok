import { describe, expect, it } from 'vitest';
import { InventoryDimension } from '@prisma/client';
import { normalizeQuantity, weightedAverageCost } from './inventory-policy.js';

describe('inventory units and valuation', () => {
  it('normalizes kg to g and l to ml', () => {
    expect(
      normalizeQuantity(
        {
          inventoryDimension: InventoryDimension.MASS,
          inventoryUnit: 'g',
          densityGramsPerMl: null,
        },
        1.5,
        'kg',
      ),
    ).toBe(1500);
    expect(
      normalizeQuantity(
        {
          inventoryDimension: InventoryDimension.VOLUME,
          inventoryUnit: 'ml',
          densityGramsPerMl: null,
        },
        2,
        'l',
      ),
    ).toBe(2000);
  });

  it('rejects mass/volume conversion without ingredient density', () => {
    expect(() =>
      normalizeQuantity(
        {
          inventoryDimension: InventoryDimension.MASS,
          inventoryUnit: 'g',
          densityGramsPerMl: null,
        },
        1,
        'ml',
      ),
    ).toThrow('Cannot convert');
  });

  it('calculates weighted average cost on receipt', () => {
    expect(weightedAverageCost(100, 2, 100, 4)).toBe(3);
  });
});
