import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { NutritionService } from '../nutrition/nutrition.service.js';

const DAY = 86400000;

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nutrition: NutritionService,
  ) {}

  async weekly(userId: string, from?: string) {
    const household = await this.prisma.household.findFirst({
      where: { ownerUserId: userId, deletedAt: null },
      include: {
        members: { where: { deletedAt: null, status: 'ACTIVE' } },
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'PAUSED'] } },
          include: { serviceDays: true },
          take: 1,
        },
      },
    });
    if (!household) throw new NotFoundException('Household not found');
    const start = from
      ? new Date(`${from}T00:00:00.000Z`)
      : new Date(
          `${new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Almaty',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date())}T00:00:00.000Z`,
        );
    const end = new Date(start.getTime() + 7 * DAY);
    const publications = await this.prisma.menuPublication.findMany({
      where: {
        status: 'PUBLISHED',
        serviceDate: { gte: start, lt: end },
      },
      include: {
        options: {
          include: {
            meal: {
              include: {
                translations: true,
                ingredients: {
                  include: {
                    ingredient: {
                      include: { allergens: { include: { allergen: true } } },
                    },
                  },
                },
                allergenRisks: { include: { allergen: true } },
                allowedAdditions: { include: { ingredient: true } },
                reviews: {
                  orderBy: { createdAt: 'desc' },
                  take: 10,
                  select: {
                    rating: true,
                    comment: true,
                    locale: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
          orderBy: [
            { mealType: 'asc' },
            { recommended: 'desc' },
            { sortOrder: 'asc' },
          ],
        },
      },
      orderBy: { serviceDate: 'asc' },
    });
    const members = await Promise.all(
      household.members.map((member) =>
        this.nutrition.ownedMember(userId, member.id),
      ),
    );
    const days = [];
    for (const publication of publications) {
      const options = [];
      for (const option of publication.options) {
        const memberSafety = [];
        for (const member of members) {
          const result = await this.nutrition.evaluate(
            member,
            option.mealId,
            [],
            [],
            [],
          );
          memberSafety.push({
            memberId: member.id,
            safe: result.safe,
            reasons: result.reasons,
          });
        }
        options.push({ ...option, memberSafety });
      }
      const serviceDay = household.subscriptions[0]?.serviceDays.find(
        (item) =>
          item.serviceDate.getTime() === publication.serviceDate.getTime(),
      );
      days.push({
        serviceDate: publication.serviceDate.toISOString().slice(0, 10),
        serviceDayStatus: serviceDay?.status ?? null,
        options,
      });
    }
    return { from: start.toISOString().slice(0, 10), days };
  }
}
