import { describe, expect, it } from 'vitest';
import { productionVariantKey } from './production-policy.js';

describe('production variant identity', () => {
  const base = {
    lineKind: 'MEAL',
    itemId: 'meal-1',
    recipe: { version: 3 },
    portionKey: 'weight:280',
  };

  it('separates incompatible portion, ingredient and allergy variants', () => {
    const regular = productionVariantKey({
      ...base,
      modification: { removedIngredientIds: [], addedIngredientIds: [] },
      restriction: { allergens: [] },
    });
    const child = productionVariantKey({ ...base, portionKey: 'weight:180' });
    const withoutMilk = productionVariantKey({
      ...base,
      modification: { removedIngredientIds: ['milk'] },
    });
    const allergy = productionVariantKey({
      ...base,
      restriction: { allergens: ['MILK'] },
    });

    expect(new Set([regular, child, withoutMilk, allergy])).toHaveLength(4);
  });

  it('does not split equivalent unordered restriction snapshots', () => {
    expect(
      productionVariantKey({ allergens: ['MILK', 'NUT'], removed: ['b', 'a'] }),
    ).toBe(
      productionVariantKey({ removed: ['a', 'b'], allergens: ['NUT', 'MILK'] }),
    );
  });
});
