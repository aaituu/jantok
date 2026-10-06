import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
  AgeGroup,
  BusinessRuleStatus,
  MealType,
  MenuPublicationStatus,
  NutritionRuleStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}
  async onApplicationBootstrap() {
    const permissionCodes = [
      'staff.access',
      'pricing.manage',
      'cutoff.override',
      'refund.manage',
      'fiscalization.manage',
      'loyalty.manage',
      'daily_order.manage',
      'delivery.manage',
      'kitchen.manage',
      'inventory.manage',
      'users.view',
      'users.edit',
      'subscriptions.create',
      'subscriptions.edit',
      'subscriptions.cancel',
      'orders.edit',
      'payments.refund',
      'menu.edit',
      'analytics.view',
      'exports.create',
      'promocodes.manage',
      'support.manage',
      'reviews.manage',
      'notifications.manage',
      'employees.manage',
      'roles.manage',
      'settings.manage',
      'bonuses.adjust',
      'audit.view',
    ];
    const permissions = new Map<string, { id: string }>();
    for (const code of permissionCodes) {
      const permission = await this.prisma.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });
      permissions.set(code, permission);
    }
    const roleDefinitions: Record<
      string,
      { name: string; permissions: string[] }
    > = {
      SUPER_ADMIN: { name: 'Super Admin', permissions: permissionCodes },
      ADMIN: {
        name: 'Admin',
        permissions: permissionCodes.filter(
          (code) =>
            !['roles.manage', 'employees.manage', 'audit.view'].includes(code),
        ),
      },
      KITCHEN_MANAGER: {
        name: 'Kitchen Manager',
        permissions: [
          'staff.access',
          'menu.edit',
          'kitchen.manage',
          'inventory.manage',
        ],
      },
      KITCHEN_WORKER: {
        name: 'Kitchen Worker',
        permissions: ['staff.access', 'kitchen.manage'],
      },
      PACKING_WORKER: {
        name: 'Packing Worker',
        permissions: ['staff.access', 'kitchen.manage'],
      },
      SUPPORT: {
        name: 'Support',
        permissions: [
          'staff.access',
          'users.view',
          'orders.edit',
          'support.manage',
          'reviews.manage',
        ],
      },
      MARKETING: {
        name: 'Marketing',
        permissions: [
          'staff.access',
          'analytics.view',
          'promocodes.manage',
          'loyalty.manage',
          'notifications.manage',
        ],
      },
      FINANCE: {
        name: 'Finance',
        permissions: [
          'staff.access',
          'payments.refund',
          'refund.manage',
          'fiscalization.manage',
          'analytics.view',
          'exports.create',
        ],
      },
      ANALYST: {
        name: 'Analyst',
        permissions: ['staff.access', 'analytics.view', 'exports.create'],
      },
    };
    const roles = new Map<string, { id: string }>();
    for (const [code, definition] of Object.entries(roleDefinitions)) {
      const role = await this.prisma.role.upsert({
        where: { code },
        create: { code, name: definition.name },
        update: { name: definition.name },
      });
      roles.set(code, role);
      for (const permissionCode of definition.permissions) {
        const permission = permissions.get(permissionCode)!;
        await this.prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id,
            },
          },
          create: { roleId: role.id, permissionId: permission.id },
          update: {},
        });
      }
    }
    const isLocal = ['local', 'test'].includes(process.env.APP_ENV ?? 'local');
    const configuredPhones = isLocal
      ? (process.env.LOCAL_DEMO_ADMIN_PHONES ?? '')
      : `${process.env.SUPER_ADMIN_PHONE_1 ?? ''},${process.env.SUPER_ADMIN_PHONE_2 ?? ''}`;
    const phones = configuredPhones
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    for (const phone of phones) {
      const employee = await this.prisma.employee.upsert({
        where: { phone },
        create: { phone },
        update: {},
      });
      await this.prisma.employeeRole.upsert({
        where: {
          employeeId_roleId: {
            employeeId: employee.id,
            roleId: roles.get('SUPER_ADMIN')!.id,
          },
        },
        create: {
          employeeId: employee.id,
          roleId: roles.get('SUPER_ADMIN')!.id,
        },
        update: {},
      });
    }
    if (
      isLocal &&
      String(process.env.DEMO_SEED_ENABLED ?? 'false').toLowerCase() === 'true'
    ) {
      for (const fixture of [
        { phone: '+77000000101', role: 'KITCHEN_MANAGER' },
        { phone: '+77000000102', role: 'PACKING_WORKER' },
        { phone: '+77000000103', role: 'SUPPORT' },
        { phone: '+77000000104', role: 'FINANCE' },
        { phone: '+77000000105', role: 'MARKETING' },
      ]) {
        const employee = await this.prisma.employee.upsert({
          where: { phone: fixture.phone },
          create: { phone: fixture.phone, status: 'ACTIVE' },
          update: { status: 'ACTIVE' },
        });
        await this.prisma.employeeRole.upsert({
          where: {
            employeeId_roleId: {
              employeeId: employee.id,
              roleId: roles.get(fixture.role)!.id,
            },
          },
          create: {
            employeeId: employee.id,
            roleId: roles.get(fixture.role)!.id,
          },
          update: {},
        });
      }
      await this.seedDemoCatalog();
    }
  }
  private async seedDemoCatalog() {
    const mainLocation = await this.prisma.storageLocation.upsert({
      where: { code: 'MAIN' },
      create: { code: 'MAIN', name: 'Основной склад кухни', active: true },
      update: { active: true },
    });
    const pushEvents = [
      'ORDER_IN_PRODUCTION',
      'COURIER_DEPARTED',
      'DELIVERY_APPROACHING',
      'TOMORROW_MENU_AVAILABLE',
      'CUTOFF_REMINDER',
      'RENEWAL_NOTICE',
      'PAYMENT_RESULT',
      'ORDER_PROBLEM',
      'SUPPORT_REPLY',
    ];
    const pushText: Record<string, Record<string, [string, string]>> = {
      kk: {
        default: ['JANTOK', 'Қосымшада жаңарту бар.'],
        SUPPORT_REPLY: ['JANTOK қолдауы', 'Өтінішіңізге жаңа жауап келді.'],
      },
      ru: {
        default: ['JANTOK', 'В приложении есть обновление.'],
        SUPPORT_REPLY: [
          'Поддержка JANTOK',
          'В обращении появился новый ответ.',
        ],
      },
      en: {
        default: ['JANTOK', 'There is an update in the app.'],
        SUPPORT_REPLY: [
          'JANTOK Support',
          'Your support thread has a new reply.',
        ],
      },
    };
    for (const eventCode of pushEvents)
      for (const locale of ['kk', 'ru', 'en']) {
        const [titleTemplate, bodyTemplate] =
          pushText[locale][eventCode] ?? pushText[locale].default;
        await this.prisma.notificationTemplate.upsert({
          where: {
            eventCode_locale_version: { eventCode, locale, version: 1 },
          },
          create: {
            eventCode,
            locale,
            version: 1,
            status: 'DEMO',
            titleTemplate,
            bodyTemplate,
          },
          update: {},
        });
      }
    const demoPhoto =
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"%3E%3Crect width="640" height="360" fill="%23eef7f1"/%3E%3Ccircle cx="320" cy="180" r="112" fill="%23ffffff" stroke="%23176b4d" stroke-width="14"/%3E%3Cpath d="M245 190c45 38 105 38 150 0" fill="none" stroke="%23d8a24a" stroke-width="34" stroke-linecap="round"/%3E%3C/svg%3E';
    for (const [sortOrder, code] of ['LOW', 'MEDIUM', 'HIGH'].entries())
      await this.prisma.activityLevel.upsert({
        where: { code },
        create: { code, sortOrder, nameKk: code, nameRu: code, nameEn: code },
        update: {},
      });
    await this.prisma.sportType.upsert({
      where: { code: 'OTHER' },
      create: {
        code: 'OTHER',
        nameKk: 'Басқа',
        nameRu: 'Другое',
        nameEn: 'Other',
      },
      update: {},
    });
    const balancedDiet = await this.prisma.dietType.upsert({
      where: { code: 'BALANCED' },
      create: {
        code: 'BALANCED',
        nameKk: 'Теңгерімді',
        nameRu: 'Сбалансированный',
        nameEn: 'Balanced',
      },
      update: {},
    });
    const milk = await this.prisma.allergen.upsert({
      where: { code: 'MILK' },
      create: { code: 'MILK', nameKk: 'Сүт', nameRu: 'Молоко', nameEn: 'Milk' },
      update: {},
    });
    const milkIngredient = await this.prisma.ingredient.upsert({
      where: { code: 'MILK' },
      create: {
        code: 'MILK',
        nameKk: 'Сүт',
        nameRu: 'Молоко',
        nameEn: 'Milk',
        verified: true,
      },
      update: { verified: true },
    });
    const oats = await this.prisma.ingredient.upsert({
      where: { code: 'OATS' },
      create: {
        code: 'OATS',
        nameKk: 'Сұлы',
        nameRu: 'Овёс',
        nameEn: 'Oats',
        verified: true,
        caloriesPer100g: 389,
        proteinPer100g: 16.9,
        fatPer100g: 6.9,
        carbPer100g: 66.3,
      },
      update: {
        verified: true,
        caloriesPer100g: 389,
        proteinPer100g: 16.9,
        fatPer100g: 6.9,
        carbPer100g: 66.3,
      },
    });
    await this.prisma.ingredientAllergen.upsert({
      where: {
        ingredientId_allergenId: {
          ingredientId: milkIngredient.id,
          allergenId: milk.id,
        },
      },
      create: { ingredientId: milkIngredient.id, allergenId: milk.id },
      update: {},
    });
    const lowActivity = await this.prisma.activityLevel.findUniqueOrThrow({
      where: { code: 'LOW' },
    });
    const ensureMember = async (
      householdId: string,
      firstName: string,
      birthDate: string,
      completed: boolean,
    ) => {
      const existing = await this.prisma.householdMember.findFirst({
        where: { householdId, firstName },
      });
      const member =
        existing ??
        (await this.prisma.householdMember.create({
          data: { householdId, firstName, birthDate: new Date(birthDate) },
        }));
      await this.prisma.memberProfile.upsert({
        where: { memberId: member.id },
        create: {
          memberId: member.id,
          biologicalSex: 'UNSPECIFIED',
          heightCm: completed ? 165 : null,
          weightKg: completed ? 60 : null,
          activityLevelId: completed ? lowActivity.id : null,
          sportIntensity: 'NONE',
          goal: completed ? 'MAINTAIN' : null,
          dietTypeId: completed ? balancedDiet.id : null,
          allergyDeclarationStatus: completed ? 'NONE' : 'NOT_ANSWERED',
          portionPreference: 'RECOMMENDED',
          questionnaireCompletedAt: completed ? new Date() : null,
        },
        update: {},
      });
      return member;
    };
    const ensureHousehold = async (
      phone: string,
      firstName: string,
      name: string,
      completed: boolean,
    ) => {
      const user = await this.prisma.user.upsert({
        where: { phone },
        create: {
          phone,
          firstName,
          lastName: 'Demo',
          locale: 'ru',
          referralCode: `DEMO${phone.slice(-4)}`,
        },
        update: {},
      });
      return this.prisma.household.upsert({
        where: { ownerUserId: user.id },
        create: {
          ownerUserId: user.id,
          name,
          onboardingStep: completed ? 'COMPLETED' : 'FAMILY',
          onboardingCompletedAt: completed ? new Date() : null,
        },
        update: {},
      });
    };
    const incompleteHousehold = await ensureHousehold(
      '+77000000201',
      'Incomplete',
      'DEMO — анкета не завершена',
      false,
    );
    await ensureMember(
      incompleteHousehold.id,
      'Анкета не завершена',
      '1995-01-01',
      false,
    );
    const singleHousehold = await ensureHousehold(
      '+77000000202',
      'Single',
      'DEMO — один участник без подписки',
      true,
    );
    await ensureMember(singleHousehold.id, 'Один участник', '1990-01-01', true);
    const familyHousehold = await ensureHousehold(
      '+77000000203',
      'Family',
      'DEMO — семья и аллергия',
      true,
    );
    await ensureMember(familyHousehold.id, 'Взрослый', '1988-01-01', true);
    await ensureMember(familyHousehold.id, 'Ребёнок', '2017-01-01', true);
    const allergicMember = await ensureMember(
      familyHousehold.id,
      'Участник с аллергией',
      '2004-01-01',
      true,
    );
    await this.prisma.memberProfile.update({
      where: { memberId: allergicMember.id },
      data: { allergyDeclarationStatus: 'DECLARED' },
    });
    await this.prisma.memberAllergy.upsert({
      where: {
        memberId_allergenId: {
          memberId: allergicMember.id,
          allergenId: milk.id,
        },
      },
      create: { memberId: allergicMember.id, allergenId: milk.id },
      update: {},
    });
    await this.prisma.inventoryBalance.upsert({
      where: {
        ingredientId_storageLocationId: {
          ingredientId: oats.id,
          storageLocationId: mainLocation.id,
        },
      },
      create: {
        ingredientId: oats.id,
        storageLocationId: mainLocation.id,
      },
      update: {},
    });
    const safeMeal = await this.prisma.meal.upsert({
      where: { code: 'DEMO_OAT_PORRIDGE_WATER' },
      create: {
        code: 'DEMO_OAT_PORRIDGE_WATER',
        mealType: MealType.BREAKFAST,
        compositionVerified: true,
        caloriesKcal: 250,
        proteinGrams: 8,
        fatGrams: 5,
        carbGrams: 42,
        servingWeightGrams: 80,
        photoUrl: demoPhoto,
      },
      update: {
        compositionVerified: true,
        servingWeightGrams: 80,
        photoUrl: demoPhoto,
      },
    });
    const milkMeal = await this.prisma.meal.upsert({
      where: { code: 'DEMO_MILK_PORRIDGE' },
      create: {
        code: 'DEMO_MILK_PORRIDGE',
        mealType: MealType.BREAKFAST,
        compositionVerified: true,
        caloriesKcal: 300,
        proteinGrams: 12,
        fatGrams: 8,
        carbGrams: 45,
        servingWeightGrams: 280,
        photoUrl: demoPhoto,
      },
      update: {
        compositionVerified: true,
        servingWeightGrams: 280,
        photoUrl: demoPhoto,
      },
    });
    const lunchMeal = await this.prisma.meal.upsert({
      where: { code: 'DEMO_OAT_LUNCH' },
      create: {
        code: 'DEMO_OAT_LUNCH',
        mealType: MealType.LUNCH,
        compositionVerified: true,
        caloriesKcal: 389,
        proteinGrams: 16.9,
        fatGrams: 6.9,
        carbGrams: 66.3,
        servingWeightGrams: 100,
        photoUrl: demoPhoto,
      },
      update: { compositionVerified: true, photoUrl: demoPhoto },
    });
    const dinnerMeal = await this.prisma.meal.upsert({
      where: { code: 'DEMO_OAT_DINNER' },
      create: {
        code: 'DEMO_OAT_DINNER',
        mealType: MealType.DINNER,
        compositionVerified: true,
        caloriesKcal: 311,
        proteinGrams: 13.52,
        fatGrams: 5.52,
        carbGrams: 53.04,
        servingWeightGrams: 80,
        photoUrl: demoPhoto,
      },
      update: { compositionVerified: true, photoUrl: demoPhoto },
    });
    const lunchAlt = await this.prisma.meal.upsert({
      where: { code: 'DEMO_OAT_LUNCH_ALT' },
      create: {
        code: 'DEMO_OAT_LUNCH_ALT',
        mealType: MealType.LUNCH,
        compositionVerified: true,
        caloriesKcal: 350,
        proteinGrams: 15.21,
        fatGrams: 6.21,
        carbGrams: 59.67,
        servingWeightGrams: 90,
        photoUrl: demoPhoto,
      },
      update: { compositionVerified: true, photoUrl: demoPhoto },
    });
    const dinnerAlt = await this.prisma.meal.upsert({
      where: { code: 'DEMO_OAT_DINNER_ALT' },
      create: {
        code: 'DEMO_OAT_DINNER_ALT',
        mealType: MealType.DINNER,
        compositionVerified: true,
        caloriesKcal: 272,
        proteinGrams: 11.83,
        fatGrams: 4.83,
        carbGrams: 46.41,
        servingWeightGrams: 70,
        photoUrl: demoPhoto,
      },
      update: { compositionVerified: true, photoUrl: demoPhoto },
    });
    for (const [meal, ingredient, amount] of [
      [safeMeal, oats, 80],
      [milkMeal, oats, 80],
      [milkMeal, milkIngredient, 200],
      [lunchMeal, oats, 100],
      [dinnerMeal, oats, 80],
      [lunchAlt, oats, 90],
      [dinnerAlt, oats, 70],
    ] as const)
      await this.prisma.mealIngredient.upsert({
        where: {
          mealId_ingredientId: { mealId: meal.id, ingredientId: ingredient.id },
        },
        create: {
          mealId: meal.id,
          ingredientId: ingredient.id,
          amount,
          unit: 'g',
        },
        update: {},
      });
    const names: Record<string, Record<string, string>> = {
      DEMO_OAT_PORRIDGE_WATER: {
        kk: 'Судағы сұлы ботқасы',
        ru: 'Овсяная каша на воде',
        en: 'Oat porridge with water',
      },
      DEMO_MILK_PORRIDGE: {
        kk: 'Сүтті сұлы ботқасы',
        ru: 'Молочная овсяная каша',
        en: 'Milk oat porridge',
      },
      DEMO_OAT_LUNCH: {
        kk: 'Сұлы түскі асы',
        ru: 'Овсяный обед',
        en: 'Oat lunch bowl',
      },
      DEMO_OAT_DINNER: {
        kk: 'Сұлы кешкі асы',
        ru: 'Овсяный ужин',
        en: 'Oat dinner bowl',
      },
      DEMO_OAT_LUNCH_ALT: {
        kk: 'Жеңіл сұлы түскі асы',
        ru: 'Лёгкий овсяный обед',
        en: 'Light oat lunch',
      },
      DEMO_OAT_DINNER_ALT: {
        kk: 'Жеңіл сұлы кешкі асы',
        ru: 'Лёгкий овсяный ужин',
        en: 'Light oat dinner',
      },
    };
    for (const meal of [
      safeMeal,
      milkMeal,
      lunchMeal,
      lunchAlt,
      dinnerMeal,
      dinnerAlt,
    ])
      for (const locale of ['kk', 'ru', 'en'])
        await this.prisma.mealTranslation.upsert({
          where: { mealId_locale: { mealId: meal.id, locale } },
          create: {
            mealId: meal.id,
            locale,
            name: names[meal.code][locale],
            description: names[meal.code][locale],
          },
          update: {
            name: names[meal.code][locale],
            description: names[meal.code][locale],
          },
        });
    await this.prisma.mealAllergenRisk.upsert({
      where: {
        mealId_allergenId_riskType: {
          mealId: milkMeal.id,
          allergenId: milk.id,
          riskType: 'CONTAINS',
        },
      },
      create: {
        mealId: milkMeal.id,
        allergenId: milk.id,
        riskType: 'CONTAINS',
      },
      update: {},
    });
    const snackCategory = await this.prisma.addonCategory.upsert({
      where: { code: 'SNACKS' },
      create: {
        code: 'SNACKS',
        nameKk: 'Тіскебасарлар',
        nameRu: 'Перекусы',
        nameEn: 'Snacks',
      },
      update: {},
    });
    const oatAddon = await this.prisma.addon.upsert({
      where: { code: 'DEMO_OAT_SNACK' },
      create: {
        code: 'DEMO_OAT_SNACK',
        nameKk: 'Сұлы тіскебасары',
        nameRu: 'Овсяный перекус',
        nameEn: 'Oat snack',
        verified: true,
        priceKzt: 100,
        recurringPriceKzt: 90,
        stockUnits: 100000,
        categoryId: snackCategory.id,
        descriptionKk: 'DEMO сұлы тіскебасары',
        descriptionRu: 'DEMO овсяный перекус',
        descriptionEn: 'DEMO oat snack',
      },
      update: {
        verified: true,
        priceKzt: 100,
        recurringPriceKzt: 90,
        categoryId: snackCategory.id,
      },
    });
    await this.prisma.addonIngredient.upsert({
      where: {
        addonId_ingredientId: {
          addonId: oatAddon.id,
          ingredientId: oats.id,
        },
      },
      create: {
        addonId: oatAddon.id,
        ingredientId: oats.id,
        amount: 30,
        unit: 'g',
      },
      update: {},
    });
    const groups = [
      AgeGroup.AGE_0_5,
      AgeGroup.AGE_6_12,
      AgeGroup.AGE_13_17,
      AgeGroup.AGE_18_PLUS,
    ];
    for (const [index, ageGroup] of groups.entries()) {
      const rule = await this.prisma.nutritionRuleSet.upsert({
        where: { version: index + 1 },
        create: {
          version: index + 1,
          status: NutritionRuleStatus.DEMO,
          ageGroup,
          disclaimerKk: 'DEMO: медициналық норма емес',
          disclaimerRu: 'DEMO: не является медицинской нормой',
          disclaimerEn: 'DEMO: not a medical standard',
        },
        update: {},
      });
      const values = {
        base_kcal: 500 + index * 150,
        weight_kcal_per_kg: 10,
        height_kcal_per_cm: 4,
        age_kcal_per_year: 2,
        activity_multiplier_LOW: 0.9,
        activity_multiplier_MEDIUM: 1,
        activity_multiplier_HIGH: 1.1,
        goal_multiplier_LOSE_WEIGHT: 0.9,
        goal_multiplier_MAINTAIN: 1,
        goal_multiplier_GAIN_WEIGHT: 1.1,
        goal_multiplier_SPORT: 1.1,
        sport_kcal_per_hour: 25,
        sport_intensity_NONE: 0,
        sport_intensity_LIGHT: 0.75,
        sport_intensity_MODERATE: 1,
        sport_intensity_HIGH: 1.25,
        protein_ratio: 0.2,
        fat_ratio: 0.3,
        carb_ratio: 0.5,
      };
      for (const [key, value] of Object.entries(values))
        await this.prisma.nutritionCoefficient.upsert({
          where: { ruleSetId_key: { ruleSetId: rule.id, key } },
          create: { ruleSetId: rule.id, key, value },
          update: { value },
        });
    }
    const cutoff = await this.prisma.cutoffPolicy.upsert({
      where: { version: 1 },
      create: { version: 1, status: BusinessRuleStatus.DEMO },
      update: {},
    });
    await this.prisma.pricingRuleSet.upsert({
      where: { version: 1 },
      create: {
        version: 1,
        status: BusinessRuleStatus.DEMO,
        adultMonthlyKzt: 30000,
        teenMonthlyKzt: 27000,
        childMonthlyKzt: 24000,
        infantMonthlyKzt: 18000,
        secondMemberDiscountBps: 500,
        thirdPlusDiscountBps: 1000,
        guestDayKzt: 1200,
      },
      update: {},
    });
    await this.prisma.loyaltySettings.upsert({
      where: { version: 1 },
      create: {
        version: 1,
        status: BusinessRuleStatus.DEMO,
        welcomeBonusBps: 1000,
        bonusKztPerUnit: 1,
        maxRedemptionBps: 10000,
        welcomeBase: 'CASH_AFTER_DISCOUNTS',
        allowMultiplePromos: false,
        partialRefundKeepsClubCycle: false,
      },
      update: {},
    });
    await this.prisma.promoCode.upsert({
      where: { code: 'DEMO10' },
      create: {
        code: 'DEMO10',
        mechanic: 'PERCENT_DISCOUNT',
        value: 1000,
        status: BusinessRuleStatus.DEMO,
        totalUseLimit: 100000,
        perHouseholdUseLimit: 1,
        minSubtotalKzt: 1000,
        applicableOperations: ['SUBSCRIPTION'],
        applicableProductCodes: [],
        compatibleCodes: [],
      },
      update: {},
    });
    for (const tier of [
      { code: 'DEMO_REF_1', minQualifiedReferrals: 1, rewardBps: 200 },
      { code: 'DEMO_REF_3', minQualifiedReferrals: 3, rewardBps: 500 },
      { code: 'DEMO_REF_5', minQualifiedReferrals: 5, rewardBps: 1000 },
    ])
      await this.prisma.referralTier.upsert({
        where: { code: tier.code },
        create: { ...tier, status: BusinessRuleStatus.DEMO },
        update: {},
      });
    for (const tier of [
      { code: 'DEMO_MEMBER', thresholdPaidCycles: 3 },
      { code: 'DEMO_SILVER', thresholdPaidCycles: 6 },
      { code: 'DEMO_GOLD', thresholdPaidCycles: 12 },
      { code: 'DEMO_PLATINUM', thresholdPaidCycles: 24 },
    ])
      await this.prisma.clubTier.upsert({
        where: { code: tier.code },
        create: {
          ...tier,
          nameKk: tier.code.replace('DEMO_', ''),
          nameRu: tier.code.replace('DEMO_', ''),
          nameEn: tier.code.replace('DEMO_', ''),
          status: BusinessRuleStatus.DEMO,
          benefits: { demo: true },
        },
        update: {},
      });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const meals = [
      safeMeal,
      milkMeal,
      lunchMeal,
      lunchAlt,
      dinnerMeal,
      dinnerAlt,
    ];
    for (let offset = 0; offset < 45; offset++) {
      const serviceDate = new Date(today.getTime() + offset * 86400000);
      const publication = await this.prisma.menuPublication.upsert({
        where: { serviceDate },
        create: {
          serviceDate,
          status: MenuPublicationStatus.PUBLISHED,
          publishedAt: new Date(),
        },
        update: {},
      });
      for (const meal of meals)
        await this.prisma.publishedMenuOption.upsert({
          where: {
            publicationId_mealType_mealId: {
              publicationId: publication.id,
              mealType: meal.mealType,
              mealId: meal.id,
            },
          },
          create: {
            publicationId: publication.id,
            mealId: meal.id,
            mealType: meal.mealType,
            recommended:
              meal.id === safeMeal.id ||
              meal.id === lunchMeal.id ||
              meal.id === dinnerMeal.id,
            sortOrder: [milkMeal.id, lunchAlt.id, dinnerAlt.id].includes(
              meal.id,
            )
              ? 1
              : 0,
          },
          update: {},
        });
    }
    void cutoff;
  }
}
