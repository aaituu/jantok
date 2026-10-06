import { AgeGroup } from '@prisma/client';
import { ageGroupAt, calculateNutrition } from './nutrition.service.js';

describe('ageGroupAt', () => {
  const serviceDate = new Date('2026-09-22T00:00:00.000Z');
  it.each([
    ['2021-09-22', AgeGroup.AGE_0_5],
    ['2020-09-22', AgeGroup.AGE_6_12],
    ['2013-09-22', AgeGroup.AGE_13_17],
    ['2008-09-22', AgeGroup.AGE_18_PLUS],
  ])('maps birthday %s to %s at exact boundary', (birthday, expected) => {
    expect(ageGroupAt(new Date(`${birthday}T00:00:00.000Z`), serviceDate)).toBe(
      expected,
    );
  });
  it('uses age on service date, not current age', () => {
    expect(ageGroupAt(new Date('2008-09-23T00:00:00.000Z'), serviceDate)).toBe(
      AgeGroup.AGE_13_17,
    );
  });
});

describe('calculateNutrition', () => {
  const coefficients = {
    base_kcal: 500,
    weight_kcal_per_kg: 10,
    height_kcal_per_cm: 4,
    age_kcal_per_year: 2,
    activity_multiplier_HIGH: 1.1,
    goal_multiplier_MAINTAIN: 1,
    sport_kcal_per_hour: 25,
    sport_intensity_MODERATE: 1,
    protein_ratio: 0.2,
    fat_ratio: 0.3,
    carb_ratio: 0.5,
  };
  it('uses only versioned coefficients and returns deterministic macros', () => {
    expect(
      calculateNutrition(
        coefficients,
        {
          weightKg: 70,
          heightCm: 170,
          age: 30,
          activityCode: 'HIGH',
          goal: 'MAINTAIN',
          sportHoursPerWeek: 2,
          sportIntensity: 'MODERATE',
        },
        7,
      ),
    ).toEqual({
      caloriesKcal: 2052,
      proteinGrams: 102.6,
      fatGrams: 68.4,
      carbGrams: 256.5,
    });
  });
  it('rejects incomplete rule sets', () => {
    expect(() =>
      calculateNutrition(
        { ...coefficients, carb_ratio: 0.4 },
        {
          weightKg: 70,
          heightCm: 170,
          age: 30,
          activityCode: 'HIGH',
          goal: 'MAINTAIN',
          sportHoursPerWeek: 2,
          sportIntensity: 'MODERATE',
        },
        7,
      ),
    ).toThrow('must total 1');
  });
});
