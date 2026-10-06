import { InventoryDimension } from '@prisma/client';

export type IngredientUnitPolicy = {
  inventoryDimension: InventoryDimension;
  inventoryUnit: string;
  densityGramsPerMl: number | null;
};

const unit = (value: string) => value.trim().toLowerCase();

export function normalizeQuantity(
  ingredient: IngredientUnitPolicy,
  amount: number,
  inputUnit: string,
) {
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error('Quantity must be a non-negative finite number');
  const input = unit(inputUnit);
  const canonical = unit(ingredient.inventoryUnit);
  const mass: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000 };
  const volume: Record<string, number> = {
    ml: 1,
    milliliter: 1,
    milliliters: 1,
    l: 1000,
    liter: 1000,
    liters: 1000,
  };
  const count: Record<string, number> = {
    piece: 1,
    pieces: 1,
    pcs: 1,
    unit: 1,
    units: 1,
    шт: 1,
  };
  const convertWithin = (table: Record<string, number>) => {
    if (table[input] == null || table[canonical] == null) return null;
    return (amount * table[input]) / table[canonical];
  };
  const within =
    ingredient.inventoryDimension === InventoryDimension.MASS
      ? convertWithin(mass)
      : ingredient.inventoryDimension === InventoryDimension.VOLUME
        ? convertWithin(volume)
        : convertWithin(count);
  if (within != null) return within;
  if (ingredient.densityGramsPerMl && ingredient.densityGramsPerMl > 0) {
    if (mass[input] != null && volume[canonical] != null)
      return (
        (amount * mass[input]) /
        ingredient.densityGramsPerMl /
        volume[canonical]
      );
    if (volume[input] != null && mass[canonical] != null)
      return (
        (amount * volume[input] * ingredient.densityGramsPerMl) /
        mass[canonical]
      );
  }
  throw new Error(
    `Cannot convert ${inputUnit} to ${ingredient.inventoryUnit} for ${ingredient.inventoryDimension}`,
  );
}

export function weightedAverageCost(
  onHand: number,
  currentUnitCost: number,
  received: number,
  receivedUnitCost: number,
) {
  const next = onHand + received;
  if (next <= 0) return 0;
  return (onHand * currentUnitCost + received * receivedUnitCost) / next;
}
