import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

const RESOURCE_PERMISSION: Record<string, string> = {
  customers: 'users.view',
  households: 'users.view',
  members: 'users.view',
  subscriptions: 'subscriptions.edit',
  orders: 'orders.edit',
  menus: 'menu.edit',
  meals: 'menu.edit',
  ingredients: 'menu.edit',
  allergens: 'menu.edit',
  nutrition: 'menu.edit',
  kitchen: 'kitchen.manage',
  production: 'kitchen.manage',
  packing: 'kitchen.manage',
  labels: 'kitchen.manage',
  inventory: 'inventory.manage',
  suppliers: 'inventory.manage',
  purchases: 'inventory.manage',
  waste: 'inventory.manage',
  deliveries: 'delivery.manage',
  payments: 'refund.manage',
  refunds: 'refund.manage',
  receipts: 'fiscalization.manage',
  addons: 'menu.edit',
  promocodes: 'promocodes.manage',
  club: 'loyalty.manage',
  bonuses: 'bonuses.adjust',
  referrals: 'loyalty.manage',
  reviews: 'reviews.manage',
  support: 'support.manage',
  notifications: 'notifications.manage',
  exports: 'exports.create',
  employees: 'employees.manage',
  roles: 'roles.manage',
  permissions: 'roles.manage',
  audit: 'audit.view',
  settings: 'settings.manage',
};

@Injectable()
export class AdminResourceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(resource: string, permissions: string[], page = 1, pageSize = 25) {
    const required = RESOURCE_PERMISSION[resource];
    if (!required) throw new NotFoundException('Unknown admin resource');
    if (
      !permissions.includes(required) &&
      !permissions.includes('roles.manage')
    )
      throw new ForbiddenException({
        code: 'RESOURCE_SCOPE_DENIED',
        message: `${required} is required for ${resource}`,
      });
    const take = Math.min(100, Math.max(1, pageSize));
    const skip = (Math.max(1, page) - 1) * take;
    switch (resource) {
      case 'customers':
        return this.prisma.user.findMany({
          select: {
            id: true,
            phone: true,
            firstName: true,
            lastName: true,
            status: true,
            locale: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'households':
        return this.prisma.household.findMany({
          select: {
            id: true,
            name: true,
            timezone: true,
            onboardingStep: true,
            createdAt: true,
            _count: { select: { members: true, subscriptions: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'members':
        return this.prisma.householdMember.findMany({
          select: {
            id: true,
            householdId: true,
            firstName: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'subscriptions':
        return this.prisma.subscription.findMany({
          select: {
            id: true,
            householdId: true,
            status: true,
            startDate: true,
            currentEndDate: true,
            paidServiceDays: true,
            autoRenew: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'orders':
      case 'deliveries':
        return this.prisma.dailyFulfillment.findMany({
          select: {
            id: true,
            householdId: true,
            subscriptionId: true,
            serviceDate: true,
            status: true,
            financialStatus: true,
            dispatchAt: true,
            version: true,
          },
          orderBy: [{ serviceDate: 'desc' }, { id: 'asc' }],
          skip,
          take,
        });
      case 'menus':
        return this.prisma.menuPublication.findMany({
          include: { _count: { select: { options: true } } },
          orderBy: { serviceDate: 'desc' },
          skip,
          take,
        });
      case 'meals':
        return this.prisma.meal.findMany({
          include: { translations: true },
          orderBy: { code: 'asc' },
          skip,
          take,
        });
      case 'ingredients':
        return this.prisma.ingredient.findMany({
          orderBy: { code: 'asc' },
          skip,
          take,
        });
      case 'allergens':
        return this.prisma.allergen.findMany({
          orderBy: { code: 'asc' },
          skip,
          take,
        });
      case 'nutrition':
        return this.prisma.nutritionRuleSet.findMany({
          include: { _count: { select: { coefficients: true } } },
          orderBy: { version: 'desc' },
          skip,
          take,
        });
      case 'kitchen':
      case 'production':
        return this.prisma.productionRevision.findMany({
          include: { _count: { select: { lines: true, packingTasks: true } } },
          orderBy: [{ serviceDate: 'desc' }, { revision: 'desc' }],
          skip,
          take,
        });
      case 'packing':
        return this.prisma.packingTask.findMany({
          include: { _count: { select: { items: true } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'labels':
        return this.prisma.printDocument.findMany({
          orderBy: { generatedAt: 'desc' },
          skip,
          take,
        });
      case 'inventory':
        return this.prisma.inventoryBalance.findMany({
          include: {
            ingredient: {
              select: { code: true, nameRu: true, inventoryUnit: true },
            },
            storageLocation: { select: { code: true, name: true } },
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take,
        });
      case 'suppliers':
        return this.prisma.supplier.findMany({
          orderBy: { name: 'asc' },
          skip,
          take,
        });
      case 'purchases':
        return this.prisma.supplierPurchase.findMany({
          include: {
            supplier: { select: { name: true } },
            _count: { select: { items: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'waste':
        return this.prisma.wasteEntry.findMany({
          include: { ingredient: { select: { code: true, nameRu: true } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'payments':
        return this.prisma.paymentAttempt.findMany({
          select: {
            id: true,
            purchaseId: true,
            provider: true,
            providerReference: true,
            amountKzt: true,
            status: true,
            authoritativeAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'refunds':
        return this.prisma.refund.findMany({
          select: {
            id: true,
            purchaseId: true,
            kind: true,
            status: true,
            cashKzt: true,
            bonusKzt: true,
            reason: true,
            authoritativeAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'receipts':
        return this.prisma.receipt.findMany({
          select: {
            id: true,
            purchaseId: true,
            refundId: true,
            status: true,
            fiscal: true,
            provider: true,
            externalDocumentRef: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'addons':
        return this.prisma.addon.findMany({
          include: { category: true },
          orderBy: { code: 'asc' },
          skip,
          take,
        });
      case 'promocodes':
        return this.prisma.promoCode.findMany({
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'club':
        return this.prisma.clubTier.findMany({
          orderBy: { thresholdPaidCycles: 'asc' },
          skip,
          take,
        });
      case 'bonuses':
        return this.prisma.bonusLedgerEntry.findMany({
          select: {
            id: true,
            householdId: true,
            type: true,
            amountKzt: true,
            reason: true,
            referenceType: true,
            referenceId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'referrals':
        return this.prisma.referral.findMany({
          select: {
            id: true,
            referrerUserId: true,
            inviteeUserId: true,
            status: true,
            qualifiedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'reviews':
        return this.prisma.mealReview.findMany({
          select: {
            id: true,
            mealId: true,
            rating: true,
            comment: true,
            locale: true,
            status: true,
            dailyOrderLineId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'support':
        return this.prisma.supportThread.findMany({
          select: {
            id: true,
            reason: true,
            positive: true,
            subject: true,
            status: true,
            staffUnread: true,
            lastMessageAt: true,
            owner: { select: { firstName: true, lastName: true, phone: true } },
          },
          orderBy: { lastMessageAt: 'desc' },
          skip,
          take,
        });
      case 'notifications':
        return this.prisma.notificationTemplate.findMany({
          orderBy: [
            { eventCode: 'asc' },
            { locale: 'asc' },
            { version: 'desc' },
          ],
          skip,
          take,
        });
      case 'exports':
        return this.prisma.exportJob.findMany({
          select: {
            id: true,
            reportType: true,
            format: true,
            status: true,
            progress: true,
            filters: true,
            rowCount: true,
            fileName: true,
            expiresAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'employees':
        return this.prisma.employee.findMany({
          include: { roles: { include: { role: true } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
      case 'roles':
        return this.prisma.role.findMany({
          include: { permissions: { include: { permission: true } } },
          orderBy: { name: 'asc' },
          skip,
          take,
        });
      case 'permissions':
        return this.prisma.permission.findMany({
          orderBy: { code: 'asc' },
          skip,
          take,
        });
      case 'audit':
        return this.prisma.auditLog.findMany({
          orderBy: { occurredAt: 'desc' },
          skip,
          take,
        });
      case 'settings':
        return this.prisma.systemSetting.findMany({
          orderBy: [{ groupCode: 'asc' }, { key: 'asc' }, { version: 'desc' }],
          skip,
          take,
        });
      default:
        throw new NotFoundException('Unknown admin resource');
    }
  }
}
