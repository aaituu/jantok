import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EmployeeStatus, Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type {
  AdminBlockCustomerDto,
  AdminEmployeeDto,
  AdminNotificationTemplateDto,
  AdminReviewModerationDto,
} from './admin.dto.js';

@Injectable()
export class AdminGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async dashboard() {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [
      customers,
      activeSubscriptions,
      todayOrders,
      openSupport,
      paymentFailures,
      lowStock,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.dailyFulfillment.count({ where: { serviceDate: today } }),
      this.prisma.supportThread.count({
        where: { status: { in: ['OPEN', 'WAITING_FOR_SUPPORT'] } },
      }),
      this.prisma.paymentAttempt.count({
        where: {
          status: { in: ['FAILED', 'UNKNOWN'] },
          createdAt: { gte: today },
        },
      }),
      this.prisma.inventoryBalance.count({
        where: {
          onHandQuantity: {
            lte: this.prisma.inventoryBalance.fields.reservedQuantity,
          },
        },
      }),
    ]);
    return {
      generatedAt: new Date(),
      source: 'persisted-domain-data',
      customers,
      activeSubscriptions,
      todayOrders,
      openSupport,
      paymentFailures,
      lowStock,
    };
  }

  async customers(query = '', page = 1, pageSize = 25, status?: string) {
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(status ? { status: status as never } : {}),
      ...(query
        ? {
            OR: [
              { phone: { contains: query } },
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true,
          locale: true,
          status: true,
          createdAt: true,
          household: {
            select: {
              id: true,
              _count: {
                select: {
                  members: true,
                  subscriptions: true,
                  dailyFulfillments: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (safePage - 1) * safeSize,
        take: safeSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items,
      page: safePage,
      pageSize: safeSize,
      total,
      pages: Math.ceil(total / safeSize),
    };
  }

  async blockCustomer(
    actorUserId: string,
    actorEmployeeId: string,
    userId: string,
    dto: AdminBlockCustomerDto,
    requestId: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Customer not found');
    const status = dto.blocked ? 'BLOCKED' : 'ACTIVE';
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { status },
      });
      if (dto.blocked)
        await tx.userSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date(), revocationReason: 'CUSTOMER_BLOCKED' },
        });
      await this.audit.record(
        {
          actorUserId,
          actorEmployeeId,
          action: dto.blocked ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED',
          entityType: 'User',
          entityId: userId,
          oldValues: { status: user.status },
          newValues: { status },
          reason: dto.reason,
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  roles() {
    return this.prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { employees: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  employees() {
    return this.prisma.employee.findMany({
      include: {
        user: { select: { firstName: true, lastName: true } },
        roles: { include: { role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  upsertEmployee(dto: AdminEmployeeDto) {
    return this.prisma.employee.upsert({
      where: { phone: dto.phone },
      create: { phone: dto.phone, status: dto.status },
      update: { status: dto.status },
    });
  }

  async setEmployeeStatus(
    actorUserId: string,
    actorEmployeeId: string,
    employeeId: string,
    status: EmployeeStatus,
    reason: string,
    requestId: string,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { roles: { include: { role: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (
      status !== 'ACTIVE' &&
      employee.roles.some((item) => item.role.code === 'SUPER_ADMIN')
    )
      await this.assertAnotherSuperAdmin(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({
        where: { id: employeeId },
        data: { status },
      });
      await this.audit.record(
        {
          actorUserId,
          actorEmployeeId,
          action: 'EMPLOYEE_STATUS_CHANGED',
          entityType: 'Employee',
          entityId: employeeId,
          oldValues: { status: employee.status },
          newValues: { status },
          reason,
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  async assignRole(
    actorUserId: string,
    actorEmployeeId: string,
    employeeId: string,
    roleCode: string,
    reason: string,
    requestId: string,
  ) {
    const role = await this.prisma.role.findUnique({
      where: { code: roleCode },
    });
    if (!role) throw new NotFoundException('Role not found');
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.employeeRole.upsert({
        where: { employeeId_roleId: { employeeId, roleId: role.id } },
        create: { employeeId, roleId: role.id },
        update: {},
      });
      await this.audit.record(
        {
          actorUserId,
          actorEmployeeId,
          action: 'EMPLOYEE_ROLE_ASSIGNED',
          entityType: 'Employee',
          entityId: employeeId,
          newValues: { roleCode },
          reason,
          requestId,
        },
        tx,
      );
      return result;
    });
  }

  async removeRole(
    actorUserId: string,
    actorEmployeeId: string,
    employeeId: string,
    roleCode: string,
    reason: string,
    requestId: string,
  ) {
    const role = await this.prisma.role.findUnique({
      where: { code: roleCode },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (roleCode === 'SUPER_ADMIN')
      await this.assertAnotherSuperAdmin(employeeId);
    return this.prisma.$transaction(async (tx) => {
      await tx.employeeRole.delete({
        where: { employeeId_roleId: { employeeId, roleId: role.id } },
      });
      await this.audit.record(
        {
          actorUserId,
          actorEmployeeId,
          action: 'EMPLOYEE_ROLE_REMOVED',
          entityType: 'Employee',
          entityId: employeeId,
          oldValues: { roleCode },
          reason,
          requestId,
        },
        tx,
      );
      return { employeeId, roleCode, removed: true };
    });
  }

  auditLogs(page = 1, pageSize = 50, entityType?: string) {
    return this.prisma.auditLog.findMany({
      where: entityType ? { entityType } : {},
      orderBy: { occurredAt: 'desc' },
      skip: (Math.max(1, page) - 1) * Math.min(100, Math.max(1, pageSize)),
      take: Math.min(100, Math.max(1, pageSize)),
    });
  }

  reviews(status?: ReviewStatus) {
    return this.prisma.mealReview.findMany({
      where: status ? { status } : {},
      include: {
        meal: { select: { code: true, translations: true } },
        author: { select: { firstName: true, lastName: true } },
        dailyOrderLine: { select: { id: true, orderId: true } },
        moderationActions: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async moderateReview(
    actorUserId: string,
    actorEmployeeId: string,
    reviewId: string,
    dto: AdminReviewModerationDto,
    requestId: string,
  ) {
    const review = await this.prisma.mealReview.findUnique({
      where: { id: reviewId },
    });
    if (!review) throw new NotFoundException('Review not found');
    const newStatus: ReviewStatus =
      dto.action === 'RESTORE'
        ? 'PUBLISHED'
        : dto.action === 'HIDE'
          ? 'HIDDEN'
          : 'DELETED';
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.mealReview.update({
        where: { id: reviewId },
        data: {
          status: newStatus,
          deletedAt: newStatus === 'DELETED' ? new Date() : null,
        },
      });
      await tx.reviewModeration.create({
        data: {
          reviewId,
          actorEmployeeId,
          action: dto.action,
          reason: dto.reason,
          oldStatus: review.status,
          newStatus,
        },
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
      await this.audit.record(
        {
          actorUserId,
          actorEmployeeId,
          action: `REVIEW_${dto.action}`,
          entityType: 'MealReview',
          entityId: reviewId,
          oldValues: { status: review.status },
          newValues: { status: newStatus },
          reason: dto.reason,
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  templates() {
    return this.prisma.notificationTemplate.findMany({
      orderBy: [{ eventCode: 'asc' }, { locale: 'asc' }, { version: 'desc' }],
    });
  }

  async createTemplate(
    actorUserId: string,
    actorEmployeeId: string,
    dto: AdminNotificationTemplateDto,
    requestId: string,
  ) {
    if (
      /(allerg|diagnos|medical|weight|калор|аллерг|диагноз|салмақ)/i.test(
        `${dto.titleTemplate} ${dto.bodyTemplate}`,
      )
    )
      throw new ConflictException({
        code: 'SENSITIVE_LOCKSCREEN_CONTENT',
        message:
          'Push templates may not expose nutrition or medical data on the lock screen',
      });
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.notificationTemplate.findFirst({
        where: { eventCode: dto.eventCode, locale: dto.locale },
        orderBy: { version: 'desc' },
      });
      if (dto.status === 'APPROVED')
        await tx.notificationTemplate.updateMany({
          where: {
            eventCode: dto.eventCode,
            locale: dto.locale,
            status: 'APPROVED',
          },
          data: { status: 'RETIRED' },
        });
      const template = await tx.notificationTemplate.create({
        data: {
          eventCode: dto.eventCode,
          locale: dto.locale,
          version: (latest?.version ?? 0) + 1,
          status: dto.status,
          titleTemplate: dto.titleTemplate,
          bodyTemplate: dto.bodyTemplate,
        },
      });
      await this.audit.record(
        {
          actorUserId,
          actorEmployeeId,
          action: 'NOTIFICATION_TEMPLATE_CREATED',
          entityType: 'NotificationTemplate',
          entityId: template.id,
          oldValues: latest,
          newValues: template,
          reason: dto.reason,
          requestId,
        },
        tx,
      );
      return template;
    });
  }

  private async assertAnotherSuperAdmin(employeeId: string) {
    const count = await this.prisma.employee.count({
      where: {
        id: { not: employeeId },
        status: 'ACTIVE',
        roles: { some: { role: { code: 'SUPER_ADMIN' } } },
      },
    });
    if (count < 1)
      throw new ForbiddenException({
        code: 'LAST_SUPER_ADMIN_PROTECTED',
        message:
          'The last active Super Admin cannot be suspended or unassigned',
      });
  }
}
