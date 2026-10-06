import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AllergyDeclarationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  AddressDto,
  CreateMemberDto,
  QuestionnaireDto,
  SelectServiceDayAddressDto,
  UpdateAddressDto,
} from './household.dto.js';
import { NutritionService } from '../nutrition/nutrition.service.js';
import { DeliveryZoneService } from '../delivery/delivery-zone.service.js';

@Injectable()
export class HouseholdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nutrition: NutritionService,
    private readonly deliveryZone: DeliveryZoneService,
  ) {}
  private async household(userId: string) {
    const household = await this.prisma.household.findUnique({
      where: { ownerUserId: userId },
    });
    if (!household)
      throw new NotFoundException({
        code: 'HOUSEHOLD_NOT_FOUND',
        message: 'Household not found',
      });
    return household;
  }
  private async member(userId: string, memberId: string) {
    const household = await this.household(userId);
    const member = await this.prisma.householdMember.findFirst({
      where: { id: memberId, householdId: household.id, deletedAt: null },
    });
    if (!member)
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message: 'Member not found',
      });
    return { household, member };
  }
  async get(userId: string) {
    return this.prisma.household.findUniqueOrThrow({
      where: { ownerUserId: userId },
      include: {
        addresses: { where: { deletedAt: null } },
        members: {
          where: { deletedAt: null },
          include: {
            profile: true,
            allergies: true,
            foodPreferences: true,
            sports: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }
  async createMember(userId: string, dto: CreateMemberDto) {
    const household = await this.household(userId);
    const date = new Date(`${dto.birthDate}T00:00:00.000Z`);
    if (Number.isNaN(date.valueOf()) || date > new Date())
      throw new BadRequestException({
        code: 'INVALID_BIRTH_DATE',
        message: 'Birth date must not be in the future',
      });
    return this.prisma.householdMember.create({
      data: {
        householdId: household.id,
        firstName: dto.firstName.trim(),
        birthDate: date,
        profile: { create: {} },
      },
      include: { profile: true },
    });
  }
  async saveQuestionnaire(
    userId: string,
    memberId: string,
    dto: QuestionnaireDto,
  ) {
    const { household } = await this.member(userId, memberId);
    if (dto.allergyDeclarationStatus === AllergyDeclarationStatus.NOT_ANSWERED)
      throw new BadRequestException({
        code: 'ALLERGY_DECLARATION_REQUIRED',
        message: 'Confirm whether the member has allergies before continuing',
      });
    if (
      dto.allergyDeclarationStatus === AllergyDeclarationStatus.NONE &&
      dto.allergies.length
    )
      throw new BadRequestException({
        code: 'ALLERGY_DECLARATION_CONFLICT',
        message: 'Allergies must be empty when NONE is selected',
      });
    if (
      dto.allergyDeclarationStatus === AllergyDeclarationStatus.DECLARED &&
      !dto.allergies.length
    )
      throw new BadRequestException({
        code: 'ALLERGY_REQUIRED',
        message: 'At least one allergy is required',
      });
    for (const allergy of dto.allergies)
      if (!!allergy.allergenId === !!allergy.freeText?.trim())
        throw new BadRequestException({
          code: 'ALLERGY_SOURCE_INVALID',
          message: 'Each allergy needs either catalog ID or free text',
        });
    const futureDates = await this.prisma.nutritionRecommendation.findMany({
      where: {
        memberId,
        serviceStartDate: {
          gte: new Date(new Date().toISOString().slice(0, 10)),
        },
      },
      distinct: ['serviceStartDate'],
      select: { serviceStartDate: true },
    });
    const profile = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.memberAllergy.findMany({
        where: { memberId },
        select: { allergenId: true, freeText: true },
      });
      await tx.memberSport.deleteMany({ where: { memberId } });
      await tx.memberFoodPreference.deleteMany({ where: { memberId } });
      await tx.memberAllergy.deleteMany({ where: { memberId } });
      const profile = await tx.memberProfile.upsert({
        where: { memberId },
        create: {
          memberId,
          biologicalSex: dto.biologicalSex,
          heightCm: dto.heightCm,
          weightKg: dto.weightKg,
          activityLevelId: dto.activityLevelId,
          sportIntensity: dto.sportIntensity,
          sportHoursPerWeek: dto.sportHoursPerWeek,
          sportNotes: dto.sportNotes,
          goal: dto.goal,
          dietTypeId: dto.dietTypeId,
          allergyDeclarationStatus: dto.allergyDeclarationStatus,
          portionPreference: dto.portionPreference,
          notes: dto.notes,
          questionnaireCompletedAt: new Date(),
        },
        update: {
          biologicalSex: dto.biologicalSex,
          heightCm: dto.heightCm,
          weightKg: dto.weightKg,
          activityLevelId: dto.activityLevelId,
          sportIntensity: dto.sportIntensity,
          sportHoursPerWeek: dto.sportHoursPerWeek,
          sportNotes: dto.sportNotes,
          goal: dto.goal,
          dietTypeId: dto.dietTypeId,
          allergyDeclarationStatus: dto.allergyDeclarationStatus,
          portionPreference: dto.portionPreference,
          notes: dto.notes,
          questionnaireCompletedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (dto.sportTypeIds.length)
        await tx.memberSport.createMany({
          data: dto.sportTypeIds.map((sportTypeId) => ({
            memberId,
            sportTypeId,
          })),
        });
      if (dto.preferences.length)
        await tx.memberFoodPreference.createMany({
          data: dto.preferences.map((item) => ({
            memberId,
            ingredientId: item.ingredientId,
            kind: item.kind,
          })),
        });
      if (dto.allergies.length)
        await tx.memberAllergy.createMany({
          data: dto.allergies.map((item) => ({
            memberId,
            allergenId: item.allergenId,
            freeText: item.freeText?.trim(),
            requiresReview: Boolean(item.freeText),
          })),
        });
      const before = new Set(
        previous.map((x) => x.allergenId ?? `free:${x.freeText}`),
      );
      const added = dto.allergies.filter(
        (x) => !before.has(x.allergenId ?? `free:${x.freeText?.trim()}`),
      );
      if (added.length) {
        const future = await tx.memberMealSelection.findMany({
          where: {
            memberId,
            serviceDate: {
              gte: new Date(new Date().toISOString().slice(0, 10)),
            },
          },
        });
        await tx.memberMealSelection.updateMany({
          where: { id: { in: future.map((x) => x.id) } },
          data: { status: 'CONFLICT' },
        });
        await tx.staffTask.create({
          data: {
            type: 'ALLERGY_PROFILE_CHANGED',
            memberId,
            details: JSON.parse(
              JSON.stringify({
                added,
                affectedSelectionIds: future.map((x) => x.id),
              }),
            ) as Prisma.InputJsonValue,
          },
        });
      }
      const incomplete = await tx.memberProfile.count({
        where: {
          member: { householdId: household.id, deletedAt: null },
          questionnaireCompletedAt: null,
        },
      });
      await tx.household.update({
        where: { id: household.id },
        data: {
          onboardingStep: incomplete ? 'MEMBERS' : 'ADDRESS',
          version: { increment: 1 },
        },
      });
      return profile;
    });
    for (const item of futureDates) {
      try {
        await this.nutrition.recommend(
          userId,
          memberId,
          item.serviceStartDate.toISOString().slice(0, 10),
        );
      } catch (error) {
        await this.prisma.staffTask.create({
          data: {
            type: 'RECOMMENDATION_RECOMPUTE_FAILED',
            memberId,
            details: {
              serviceStartDate: item.serviceStartDate.toISOString(),
              reason:
                error instanceof Error
                  ? error.message
                  : 'Unknown recompute error',
            },
          },
        });
      }
    }
    return profile;
  }
  async saveAddress(userId: string, dto: AddressDto) {
    const household = await this.household(userId);
    await this.deliveryZone.assertDeliverable(dto.latitude, dto.longitude);
    const settings = await this.deliveryZone.settings();
    const time = (value?: string) =>
      value ? new Date(`1970-01-01T${value}:00.000Z`) : undefined;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${household.id}))`;
      const count = await tx.householdAddress.count({
        where: { householdId: household.id, deletedAt: null },
      });
      if (count >= settings.maxSavedAddresses)
        throw new ConflictException({
          code: 'ADDRESS_LIMIT_REACHED',
          message: `No more than ${settings.maxSavedAddresses} addresses may be saved`,
        });
      const slot = dto.deliverySlotId
        ? await tx.deliverySlot.findFirst({
            where: {
              id: dto.deliverySlotId,
              status: { in: ['ACTIVE', 'DEMO'] },
            },
          })
        : await tx.deliverySlot.findFirst({
            where: { status: { in: ['ACTIVE', 'DEMO'] } },
            orderBy: { sortOrder: 'asc' },
          });
      if (!slot)
        throw new BadRequestException({
          code: 'DELIVERY_SLOT_UNAVAILABLE',
          message: 'Delivery slot is unavailable',
        });
      if (dto.isDefault !== false)
        await tx.householdAddress.updateMany({
          where: { householdId: household.id, deletedAt: null },
          data: { isDefault: false },
        });
      const address = await tx.householdAddress.create({
        data: {
          householdId: household.id,
          label: dto.label?.trim() || 'Дом',
          city: 'Астана',
          streetAddress: dto.streetAddress.trim(),
          apartment: dto.apartment,
          entrance: dto.entrance,
          floor: dto.floor,
          intercom: dto.intercom,
          deliveryInstructions: dto.deliveryInstructions,
          landmarks: dto.landmarks,
          latitude: dto.latitude,
          longitude: dto.longitude,
          windowStart: time(dto.windowStart),
          windowEnd: time(dto.windowEnd),
          isDefault: dto.isDefault !== false,
          deliverySlotId: slot.id,
        },
      });
      await tx.household.update({
        where: { id: household.id },
        data: { onboardingStep: 'RECOMMENDATIONS', version: { increment: 1 } },
      });
      return address;
    });
  }

  async updateAddress(
    userId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ) {
    const household = await this.household(userId);
    await this.deliveryZone.assertDeliverable(dto.latitude, dto.longitude);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.householdAddress.findFirst({
        where: { id: addressId, householdId: household.id, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Address not found');
      const slot = await tx.deliverySlot.findFirst({
        where: {
          ...(dto.deliverySlotId
            ? { id: dto.deliverySlotId }
            : { id: existing.deliverySlotId ?? undefined }),
          status: { in: ['ACTIVE', 'DEMO'] },
        },
      });
      if (!slot) throw new BadRequestException('Delivery slot is unavailable');
      if (dto.isDefault)
        await tx.householdAddress.updateMany({
          where: { householdId: household.id, deletedAt: null },
          data: { isDefault: false },
        });
      const updated = await tx.householdAddress.updateMany({
        where: { id: addressId, version: dto.version, deletedAt: null },
        data: {
          label: dto.label?.trim() || existing.label,
          streetAddress: dto.streetAddress.trim(),
          apartment: dto.apartment,
          entrance: dto.entrance,
          floor: dto.floor,
          intercom: dto.intercom,
          deliveryInstructions: dto.deliveryInstructions,
          landmarks: dto.landmarks,
          latitude: dto.latitude,
          longitude: dto.longitude,
          deliverySlotId: slot.id,
          isDefault: dto.isDefault ?? existing.isDefault,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new ConflictException({
          code: 'STALE_ADDRESS_VERSION',
          message: 'Address was changed on another device',
        });
      return tx.householdAddress.findUniqueOrThrow({
        where: { id: addressId },
      });
    });
  }

  async deleteAddress(userId: string, addressId: string, version: number) {
    const household = await this.household(userId);
    return this.prisma.$transaction(async (tx) => {
      const address = await tx.householdAddress.findFirst({
        where: { id: addressId, householdId: household.id, deletedAt: null },
      });
      if (!address) throw new NotFoundException('Address not found');
      const updated = await tx.householdAddress.updateMany({
        where: { id: addressId, version, deletedAt: null },
        data: {
          deletedAt: new Date(),
          isDefault: false,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new ConflictException({
          code: 'STALE_ADDRESS_VERSION',
          message: 'Address was changed on another device',
        });
      if (address.isDefault) {
        const replacement = await tx.householdAddress.findFirst({
          where: { householdId: household.id, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        });
        if (replacement)
          await tx.householdAddress.update({
            where: { id: replacement.id },
            data: { isDefault: true, version: { increment: 1 } },
          });
      }
      return { deleted: true };
    });
  }

  async selectServiceDayAddress(
    userId: string,
    dto: SelectServiceDayAddressDto,
  ) {
    const household = await this.household(userId);
    const [day, address, slot] = await Promise.all([
      this.prisma.subscriptionServiceDay.findFirst({
        where: {
          id: dto.serviceDayId,
          subscription: { householdId: household.id },
        },
        include: { subscription: true, dailyFulfillment: true },
      }),
      this.prisma.householdAddress.findFirst({
        where: {
          id: dto.addressId,
          householdId: household.id,
          deletedAt: null,
        },
      }),
      this.prisma.deliverySlot.findFirst({
        where: { id: dto.deliverySlotId, status: { in: ['ACTIVE', 'DEMO'] } },
      }),
    ]);
    if (!day || !address || !slot)
      throw new NotFoundException('Service day, address, or slot not found');
    if (day.status !== 'PLANNED')
      throw new ConflictException({
        code: 'SERVICE_DAY_ALREADY_LOCKED',
        message: 'The service day can no longer be edited',
      });
    if (day.dailyFulfillment && day.dailyFulfillment.status !== 'SCHEDULED')
      throw new ConflictException({
        code: 'DAILY_ORDER_ALREADY_LOCKED',
        message: 'The household daily order can no longer be edited',
      });
    await this.deliveryZone.assertDeliverable(
      Number(address.latitude),
      Number(address.longitude),
    );
    const addressSnapshot = this.addressSnapshot(address);
    const slotSnapshot = this.slotSnapshot(slot);
    const settings = await this.deliveryZone.settings();
    const serviceDate = day.serviceDate.toISOString().slice(0, 10);
    const dispatchAt = new Date(
      new Date(`${serviceDate}T00:00:00+05:00`).getTime() +
        (slot.startMinutes - settings.dispatchLeadMinutes) * 60_000,
    );
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${day.id}))`;
      const existing = await tx.serviceDayAddressOverride.findUnique({
        where: { serviceDayId: day.id },
      });
      if (
        (existing && existing.version !== dto.expectedVersion) ||
        (!existing && dto.expectedVersion !== 0)
      )
        throw new ConflictException({
          code: 'STALE_SERVICE_DAY_VERSION',
          message: 'Service day address was changed on another device',
        });
      const result = await tx.serviceDayAddressOverride.upsert({
        where: { serviceDayId: day.id },
        create: {
          householdId: household.id,
          subscriptionId: day.subscriptionId,
          serviceDayId: day.id,
          addressId: address.id,
          deliverySlotId: slot.id,
          addressSnapshot,
          slotSnapshot,
        },
        update: {
          addressId: address.id,
          deliverySlotId: slot.id,
          addressSnapshot,
          slotSnapshot,
          version: { increment: 1 },
        },
      });
      await tx.dailyOrder.updateMany({
        where: { serviceDayId: day.id },
        data: { addressSnapshot },
      });
      if (day.dailyFulfillment) {
        const changed = await tx.dailyFulfillment.updateMany({
          where: {
            id: day.dailyFulfillment.id,
            status: 'SCHEDULED',
            version: day.dailyFulfillment.version,
          },
          data: {
            addressSnapshot,
            slotSnapshot,
            dispatchAt,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1)
          throw new ConflictException({
            code: 'STALE_DAILY_ORDER_VERSION',
            message: 'Daily order was finalized concurrently',
          });
      }
      return result;
    });
  }

  private addressSnapshot(address: {
    id: string;
    label: string;
    city: string;
    streetAddress: string;
    apartment: string | null;
    entrance: string | null;
    floor: string | null;
    intercom: string | null;
    deliveryInstructions: string | null;
    landmarks: string | null;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
  }) {
    return {
      addressId: address.id,
      label: address.label,
      city: address.city,
      streetAddress: address.streetAddress,
      apartment: address.apartment,
      entrance: address.entrance,
      floor: address.floor,
      intercom: address.intercom,
      deliveryInstructions: address.deliveryInstructions,
      landmarks: address.landmarks,
      latitude: address.latitude?.toString(),
      longitude: address.longitude?.toString(),
    };
  }

  private slotSnapshot(slot: {
    id: string;
    code: string;
    name: string;
    startMinutes: number;
    endMinutes: number;
  }) {
    return {
      slotId: slot.id,
      code: slot.code,
      name: slot.name,
      startMinutes: slot.startMinutes,
      endMinutes: slot.endMinutes,
      feeKzt: 0,
      capacityCap: null,
    };
  }
  catalogs() {
    return Promise.all([
      this.prisma.activityLevel.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.sportType.findMany({ where: { active: true } }),
      this.prisma.dietType.findMany({ where: { active: true } }),
      this.prisma.allergen.findMany({ where: { active: true } }),
      this.prisma.ingredient.findMany({ where: { verified: true } }),
    ]).then(
      ([activityLevels, sportTypes, dietTypes, allergens, ingredients]) => ({
        activityLevels,
        sportTypes,
        dietTypes,
        allergens,
        ingredients,
      }),
    );
  }
}
