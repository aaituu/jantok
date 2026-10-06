import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AgeGroup, NutritionRuleStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import type { MealReviewDto, SelectMealDto } from './nutrition.dto.js';
import { CutoffService } from '../cutoff/cutoff.service.js';

export function ageAt(birthDate: Date, serviceDate: Date) {
  let age = serviceDate.getUTCFullYear() - birthDate.getUTCFullYear();
  if (
    serviceDate.getUTCMonth() < birthDate.getUTCMonth() ||
    (serviceDate.getUTCMonth() === birthDate.getUTCMonth() &&
      serviceDate.getUTCDate() < birthDate.getUTCDate())
  )
    age--;
  return age;
}
export function ageGroupAt(birthDate: Date, serviceDate: Date): AgeGroup {
  const age = ageAt(birthDate, serviceDate);
  if (age < 0) throw new Error('Birth date is after service date');
  return age <= 5
    ? AgeGroup.AGE_0_5
    : age <= 12
      ? AgeGroup.AGE_6_12
      : age <= 17
        ? AgeGroup.AGE_13_17
        : AgeGroup.AGE_18_PLUS;
}

export function calculateNutrition(
  coefficients: Record<string, number>,
  input: {
    weightKg: number;
    heightCm: number;
    age: number;
    activityCode: string;
    goal: string;
    sportHoursPerWeek: number;
    sportIntensity: string;
  },
  ruleVersion: number,
) {
  const activityKey = `activity_multiplier_${input.activityCode}`;
  const goalKey = `goal_multiplier_${input.goal}`;
  const intensityKey = `sport_intensity_${input.sportIntensity}`;
  const required = [
    'base_kcal',
    'weight_kcal_per_kg',
    'height_kcal_per_cm',
    'age_kcal_per_year',
    activityKey,
    goalKey,
    'sport_kcal_per_hour',
    intensityKey,
    'protein_ratio',
    'fat_ratio',
    'carb_ratio',
  ];
  for (const key of required)
    if (coefficients[key] == null)
      throw new Error(`Rule set ${ruleVersion} misses coefficient ${key}`);
  if (
    Math.abs(
      coefficients.protein_ratio +
        coefficients.fat_ratio +
        coefficients.carb_ratio -
        1,
    ) > 0.000001
  )
    throw new Error(`Rule set ${ruleVersion} macro ratios must total 1`);
  const base =
    coefficients.base_kcal +
    input.weightKg * coefficients.weight_kcal_per_kg +
    input.heightCm * coefficients.height_kcal_per_cm -
    input.age * coefficients.age_kcal_per_year;
  const caloriesKcal = Math.max(
    1,
    Math.round(
      base * coefficients[activityKey] * coefficients[goalKey] +
        input.sportHoursPerWeek *
          coefficients.sport_kcal_per_hour *
          coefficients[intensityKey],
    ),
  );
  const twoDecimals = (value: number) => Math.round(value * 100) / 100;
  return {
    caloriesKcal,
    proteinGrams: twoDecimals((caloriesKcal * coefficients.protein_ratio) / 4),
    fatGrams: twoDecimals((caloriesKcal * coefficients.fat_ratio) / 9),
    carbGrams: twoDecimals((caloriesKcal * coefficients.carb_ratio) / 4),
  };
}

@Injectable()
export class NutritionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cutoffs: CutoffService,
  ) {}
  async ownedMember(userId: string, memberId: string) {
    const member = await this.prisma.householdMember.findFirst({
      where: {
        id: memberId,
        deletedAt: null,
        household: { ownerUserId: userId },
      },
      include: {
        profile: {
          include: {
            activityLevel: true,
            dietType: { include: { excludedTags: true } },
          },
        },
        allergies: true,
      },
    });
    if (!member)
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message: 'Member not found',
      });
    return member;
  }
  private date(raw: string) {
    return new Date(`${raw}T00:00:00.000Z`);
  }
  async evaluate(
    member: Awaited<ReturnType<NutritionService['ownedMember']>>,
    mealId: string,
    removed: string[],
    added: string[],
    addons: string[],
  ) {
    const meal = await this.prisma.meal.findUnique({
      where: { id: mealId },
      include: {
        translations: true,
        ingredients: {
          include: { ingredient: { include: { allergens: true, tags: true } } },
        },
        allergenRisks: true,
      },
    });
    if (!meal?.active)
      throw new NotFoundException({
        code: 'MEAL_NOT_FOUND',
        message: 'Meal not found',
      });
    const reasons: string[] = [];
    if (!meal.isHalal || !meal.compositionVerified)
      reasons.push('MEAL_NOT_VERIFIED_HALAL');
    if (member.allergies.some((a) => a.requiresReview || a.freeText))
      reasons.push('UNCLASSIFIED_ALLERGY_REQUIRES_REVIEW');
    const allergyIds = new Set(
      member.allergies.flatMap((a) => (a.allergenId ? [a.allergenId] : [])),
    );
    for (const risk of meal.allergenRisks)
      if (allergyIds.has(risk.allergenId))
        reasons.push(`MEAL_ALLERGEN_${risk.riskType}:${risk.allergenId}`);
    const removedSet = new Set(removed);
    const ingredients = meal.ingredients.filter(
      (item) => !(removedSet.has(item.ingredientId) && item.removable),
    );
    const invalidRemoval = removed.filter(
      (id) =>
        !meal.ingredients.some(
          (item) => item.ingredientId === id && item.removable,
        ),
    );
    if (invalidRemoval.length)
      reasons.push('NON_REMOVABLE_OR_UNKNOWN_INGREDIENT');
    const extra = await this.prisma.ingredient.findMany({
      where: {
        id: { in: added },
        allowedAdditions: {
          some: { mealId, active: true, stockUnits: { gt: 0 } },
        },
      },
      include: { allergens: true, tags: true },
    });
    if (extra.length !== added.length)
      reasons.push('ADDITION_NOT_ALLOWED_OR_OUT_OF_STOCK');
    const addonRows = await this.prisma.addon.findMany({
      where: { id: { in: addons }, active: true },
      include: {
        ingredients: {
          include: { ingredient: { include: { allergens: true, tags: true } } },
        },
      },
    });
    if (addonRows.length !== addons.length) reasons.push('UNKNOWN_ADDON');
    if (addonRows.some((x) => !x.isHalal || !x.verified))
      reasons.push('ADDON_NOT_VERIFIED_HALAL');
    const allIngredients = [
      ...ingredients.map((x) => x.ingredient),
      ...extra,
      ...addonRows.flatMap((x) => x.ingredients.map((y) => y.ingredient)),
    ];
    const excludedTags = new Set(
      member.profile?.dietType?.excludedTags.map((x) => x.tagId) ?? [],
    );
    for (const ingredient of allIngredients) {
      if (!ingredient.isHalal || !ingredient.verified)
        reasons.push(`INGREDIENT_NOT_VERIFIED:${ingredient.id}`);
      if (ingredient.allergens.some((x) => allergyIds.has(x.allergenId)))
        reasons.push(`INGREDIENT_ALLERGEN:${ingredient.id}`);
      if (ingredient.tags.some((x) => excludedTags.has(x.tagId)))
        reasons.push(`DIET_EXCLUDED:${ingredient.id}`);
    }
    return { safe: reasons.length === 0, reasons: [...new Set(reasons)], meal };
  }
  async recommend(userId: string, memberId: string, rawDate: string) {
    const member = await this.ownedMember(userId, memberId);
    const date = this.date(rawDate);
    if (!member.birthDate || !member.profile?.questionnaireCompletedAt)
      throw new UnprocessableEntityException({
        code: 'QUESTIONNAIRE_INCOMPLETE',
        message: 'Complete the member questionnaire first',
      });
    const birthDate = member.birthDate;
    const profile = member.profile;
    if (
      !profile.activityLevel ||
      !profile.goal ||
      profile.heightCm == null ||
      profile.weightKg == null
    )
      throw new UnprocessableEntityException({
        code: 'QUESTIONNAIRE_INCOMPLETE',
        message: 'Activity level and goal are required',
      });
    const group = ageGroupAt(birthDate, date);
    const requiredStatus =
      process.env.APP_ENV === 'production'
        ? NutritionRuleStatus.APPROVED
        : NutritionRuleStatus.DEMO;
    const rules = await this.prisma.nutritionRuleSet.findFirst({
      where: {
        status: requiredStatus,
        ageGroup: group,
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: date } }],
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }] }],
      },
      include: { coefficients: true },
      orderBy: { version: 'desc' },
    });
    if (!rules)
      throw new UnprocessableEntityException({
        code: 'NO_APPROVED_NUTRITION_RULES',
        message:
          'No eligible approved nutrition rules; manual review is required',
      });
    const c = Object.fromEntries(
      rules.coefficients.map((x) => [x.key, Number(x.value)]),
    );
    const nutrition = calculateNutrition(
      c,
      {
        weightKg: Number(profile.weightKg),
        heightCm: Number(profile.heightCm),
        age: ageAt(birthDate, date),
        activityCode: profile.activityLevel.code,
        goal: profile.goal,
        sportHoursPerWeek: Number(profile.sportHoursPerWeek),
        sportIntensity: profile.sportIntensity,
      },
      rules.version,
    );
    const meals = await this.prisma.meal.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
    });
    const allowed: string[] = [];
    const blocked: Record<string, string[]> = {};
    for (const meal of meals) {
      const result = await this.evaluate(member, meal.id, [], [], []);
      if (result.safe) allowed.push(meal.id);
      else blocked[meal.id] = result.reasons;
    }
    if (!allowed.length) {
      await this.prisma.staffTask.create({
        data: {
          type: 'NO_SAFE_MEAL',
          memberId,
          details: { date: rawDate, blocked },
        },
      });
      throw new UnprocessableEntityException({
        code: 'NO_SAFE_MEAL',
        message: 'No safe meal is available for this member',
        details: { blocked },
      });
    }
    const proposal = Array.from({ length: 30 }, (_, day) => ({
      date: new Date(date.getTime() + day * 86400000)
        .toISOString()
        .slice(0, 10),
      mealId: allowed[day % allowed.length],
    }));
    return this.prisma.$transaction(async (tx) => {
      const recommendation = await tx.nutritionRecommendation.create({
        data: {
          memberId,
          ruleSetId: rules.id,
          serviceStartDate: date,
          ageGroupSnapshot: group,
          inputSnapshot: {
            weightKg: Number(profile.weightKg),
            heightCm: Number(profile.heightCm),
            age: ageAt(birthDate, date),
            activityCode: profile.activityLevel!.code,
            sportIntensity: profile.sportIntensity,
            sportHoursPerWeek: Number(profile.sportHoursPerWeek),
            goal: profile.goal,
            ruleVersion: rules.version,
          },
          caloriesKcal: nutrition.caloriesKcal,
          proteinGrams: nutrition.proteinGrams,
          fatGrams: nutrition.fatGrams,
          carbGrams: nutrition.carbGrams,
          recommendedPortion: profile.portionPreference,
          allowedMealIds: allowed,
          blockedMeals: blocked,
          menuProposal: proposal,
        },
      });
      await tx.household.update({
        where: { id: member.householdId },
        data: {
          onboardingStep: 'COMPLETED',
          onboardingCompletedAt: new Date(),
          version: { increment: 1 },
        },
      });
      return recommendation;
    });
  }
  async select(userId: string, memberId: string, dto: SelectMealDto) {
    const member = await this.ownedMember(userId, memberId);
    const policy = await this.cutoffs.currentPolicy();
    this.cutoffs.assertOpen(policy, 'menu', dto.serviceDate);
    const option = await this.prisma.publishedMenuOption.findFirst({
      where: {
        mealId: dto.mealId,
        mealType: dto.mealType,
        publication: {
          serviceDate: this.date(dto.serviceDate),
          status: 'PUBLISHED',
        },
      },
    });
    if (!option)
      throw new UnprocessableEntityException({
        code: 'MEAL_NOT_PUBLISHED_FOR_SLOT',
        message: 'Meal is not a published option for this date and slot',
      });
    const result = await this.evaluate(
      member,
      dto.mealId,
      dto.removedIngredientIds,
      dto.addedIngredientIds,
      dto.addonIds,
    );
    if (!result.safe) {
      await this.prisma.staffTask.create({
        data: {
          type: 'UNSAFE_MEAL_ATTEMPT',
          memberId,
          details: { mealId: dto.mealId, reasons: result.reasons },
        },
      });
      throw new UnprocessableEntityException({
        code: 'UNSAFE_MEAL_SELECTION',
        message: 'This meal is unsafe for this member',
        details: { reasons: result.reasons },
      });
    }
    if (result.meal.mealType !== dto.mealType)
      throw new UnprocessableEntityException({
        code: 'MEAL_TYPE_MISMATCH',
        message: 'Meal does not match selected meal type',
      });
    const additions = await this.prisma.mealAllowedAddition.findMany({
      where: {
        mealId: dto.mealId,
        ingredientId: { in: dto.addedIngredientIds },
      },
      include: { ingredient: { include: { allergens: true } } },
    });
    const addons = await this.prisma.addon.findMany({
      where: { id: { in: dto.addonIds } },
      include: { ingredients: { include: { ingredient: true } } },
    });
    const removed = new Set(dto.removedIngredientIds);
    const baseIngredients = result.meal.ingredients.filter(
      (item) => !removed.has(item.ingredientId),
    );
    const nutritionItems = [
      ...baseIngredients.map((item) => ({
        ingredient: item.ingredient,
        grams: Number(item.amount),
      })),
      ...additions.map((item) => ({
        ingredient: item.ingredient,
        grams: Number(item.amountGrams),
      })),
      ...addons.flatMap((addon) =>
        addon.ingredients.map((item) => ({
          ingredient: item.ingredient,
          grams: Number(item.amount),
        })),
      ),
    ];
    const totals = nutritionItems.reduce(
      (sum, item) => ({
        weightGrams: sum.weightGrams + item.grams,
        caloriesKcal:
          sum.caloriesKcal +
          (Number(item.ingredient.caloriesPer100g) * item.grams) / 100,
        proteinGrams:
          sum.proteinGrams +
          (Number(item.ingredient.proteinPer100g) * item.grams) / 100,
        fatGrams:
          sum.fatGrams +
          (Number(item.ingredient.fatPer100g) * item.grams) / 100,
        carbGrams:
          sum.carbGrams +
          (Number(item.ingredient.carbPer100g) * item.grams) / 100,
      }),
      {
        weightGrams: 0,
        caloriesKcal: 0,
        proteinGrams: 0,
        fatGrams: 0,
        carbGrams: 0,
      },
    );
    const addonPriceKzt = addons.reduce((sum, item) => sum + item.priceKzt, 0);
    const additionPriceKzt = additions.reduce(
      (sum, item) => sum + item.priceKzt,
      0,
    );
    const data = {
      mealId: dto.mealId,
      menuOptionId: option.id,
      removedIngredientIds: dto.removedIngredientIds,
      addedIngredientIds: dto.addedIngredientIds,
      addonIds: dto.addonIds,
      status: 'SAFE' as const,
      safetySnapshot: {
        checkedAt: new Date().toISOString(),
        reasons: [],
      } as Prisma.InputJsonValue,
      recipeSnapshot: {
        mealId: result.meal.id,
        code: result.meal.code,
        recipeVersion: result.meal.recipeVersion,
        yieldFactor: Number(result.meal.yieldFactor),
        lossFactor: Number(result.meal.lossFactor),
        translations: result.meal.translations,
        ingredients: baseIngredients
          .map((item) => ({
            id: item.ingredient.id,
            code: item.ingredient.code,
            amount: Number(item.amount),
            unit: item.unit,
          }))
          .concat(
            additions.map((item) => ({
              id: item.ingredient.id,
              code: item.ingredient.code,
              amount: Number(item.amountGrams),
              unit: 'g',
            })),
          ),
        removedIngredientIds: dto.removedIngredientIds,
        addedIngredientIds: dto.addedIngredientIds,
        addonIds: dto.addonIds,
      } as Prisma.InputJsonValue,
      nutritionSnapshot: totals as Prisma.InputJsonValue,
      priceSnapshot: {
        currency: 'KZT',
        mealReplacementKzt: 0,
        additionPriceKzt,
        addonPriceKzt,
        totalKzt: additionPriceKzt + addonPriceKzt,
      } as Prisma.InputJsonValue,
    };
    return this.prisma.$transaction(async (tx) => {
      const selection = await tx.memberMealSelection.upsert({
        where: {
          memberId_serviceDate_mealType: {
            memberId,
            serviceDate: this.date(dto.serviceDate),
            mealType: dto.mealType,
          },
        },
        create: {
          memberId,
          serviceDate: this.date(dto.serviceDate),
          mealType: dto.mealType,
          ...data,
        },
        update: { ...data, version: { increment: 1 } },
      });
      const order = await tx.dailyOrder.findFirst({
        where: {
          memberId,
          serviceDate: this.date(dto.serviceDate),
          subscription: { status: { in: ['ACTIVE', 'PAUSED'] } },
        },
      });
      if (order)
        await tx.dailyOrderLine.upsert({
          where: {
            orderId_mealType: { orderId: order.id, mealType: dto.mealType },
          },
          create: {
            orderId: order.id,
            mealType: dto.mealType,
            mealSnapshot: {
              id: result.meal.id,
              code: result.meal.code,
              translations: result.meal.translations,
            },
            recipeSnapshot: data.recipeSnapshot,
            modificationSnapshot: {
              removedIngredientIds: dto.removedIngredientIds,
              addedIngredientIds: dto.addedIngredientIds,
              addonIds: dto.addonIds,
            },
            nutritionSnapshot: data.nutritionSnapshot,
            priceSnapshot: data.priceSnapshot,
          },
          update: {
            mealSnapshot: {
              id: result.meal.id,
              code: result.meal.code,
              translations: result.meal.translations,
            },
            recipeSnapshot: data.recipeSnapshot,
            modificationSnapshot: {
              removedIngredientIds: dto.removedIngredientIds,
              addedIngredientIds: dto.addedIngredientIds,
              addonIds: dto.addonIds,
            },
            nutritionSnapshot: data.nutritionSnapshot,
            priceSnapshot: data.priceSnapshot,
          },
        });
      return selection;
    });
  }
  listMeals() {
    return this.prisma.meal.findMany({
      where: { active: true },
      include: { translations: true },
      orderBy: { code: 'asc' },
    });
  }
  listAddons() {
    return this.prisma.addon.findMany({
      where: { active: true, stockUnits: { gt: 0 } },
      include: { ingredients: { include: { ingredient: true } } },
      orderBy: { code: 'asc' },
    });
  }
  async review(userId: string, mealId: string, dto: MealReviewDto) {
    const line = await this.prisma.dailyOrderLine.findUnique({
      where: { id: dto.dailyOrderLineId },
      include: {
        order: {
          include: {
            subscription: {
              select: { household: { select: { ownerUserId: true } } },
            },
            dailyFulfillment: { select: { status: true } },
          },
        },
      },
    });
    const mealSnapshot = line?.mealSnapshot as { id?: string } | undefined;
    if (
      !line ||
      line.order.subscription.household.ownerUserId !== userId ||
      mealSnapshot?.id !== mealId ||
      (line.order.status !== 'DELIVERED' &&
        line.order.dailyFulfillment?.status !== 'DELIVERED') ||
      !line.order.memberId
    )
      throw new UnprocessableEntityException({
        code: 'REVIEW_REQUIRES_DELIVERY',
        message: 'A review must reference your own delivered daily order line',
      });
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.mealReview.upsert({
        where: {
          mealId_memberId_serviceDate: {
            mealId,
            memberId: line.order.memberId!,
            serviceDate: line.order.serviceDate,
          },
        },
        create: {
          mealId,
          memberId: line.order.memberId!,
          authorUserId: userId,
          serviceDate: line.order.serviceDate,
          dailyOrderLineId: line.id,
          rating: dto.rating,
          comment: dto.comment?.trim() || null,
          locale: dto.locale,
        },
        update: {
          dailyOrderLineId: line.id,
          status: 'PUBLISHED',
          deletedAt: null,
          rating: dto.rating,
          comment: dto.comment?.trim() || null,
          locale: dto.locale,
        },
      });
      const aggregate = await tx.mealReview.aggregate({
        where: { mealId, status: 'PUBLISHED', deletedAt: null },
        _avg: { rating: true },
        _count: { rating: true },
      });
      await tx.meal.update({
        where: { id: mealId },
        data: {
          ratingAverage: aggregate._avg.rating ?? 0,
          ratingCount: aggregate._count.rating,
        },
      });
      return review;
    });
  }

  async listReviews(mealId: string) {
    const rows = await this.prisma.mealReview.findMany({
      where: { mealId, status: 'PUBLISHED', deletedAt: null },
      select: {
        id: true,
        rating: true,
        comment: true,
        locale: true,
        createdAt: true,
        author: { select: { firstName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(({ author, ...row }) => ({
      ...row,
      authorDisplayName: `${author.firstName.trim().slice(0, 1) || 'J'}.`,
    }));
  }

  async myReviews(userId: string) {
    const rows = await this.prisma.mealReview.findMany({
      where: { authorUserId: userId, deletedAt: null },
      select: {
        id: true,
        rating: true,
        comment: true,
        locale: true,
        status: true,
        serviceDate: true,
        createdAt: true,
        meal: { select: { code: true, translations: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ meal, ...row }) => ({
      ...row,
      mealName:
        meal.translations.find((item) => item.locale === row.locale)?.name ??
        meal.translations.find((item) => item.locale === 'kk')?.name ??
        meal.translations.find((item) => item.locale === 'ru')?.name ??
        meal.code,
    }));
  }

  async deleteReview(userId: string, reviewId: string) {
    const review = await this.prisma.mealReview.findFirst({
      where: { id: reviewId, authorUserId: userId, deletedAt: null },
    });
    if (!review) throw new NotFoundException('Review not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.mealReview.update({
        where: { id: reviewId },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
      const aggregate = await tx.mealReview.aggregate({
        where: { mealId: review.mealId, status: 'PUBLISHED', deletedAt: null },
        _avg: { rating: true },
        _count: { rating: true },
      });
      await tx.meal.update({
        where: { id: review.mealId },
        data: {
          ratingAverage: aggregate._avg.rating ?? 0,
          ratingCount: aggregate._count.rating,
        },
      });
    });
    return { id: reviewId, status: 'DELETED' as const };
  }
}
