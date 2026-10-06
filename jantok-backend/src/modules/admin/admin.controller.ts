import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentAuth,
  RequestId,
  type AuthContext,
} from '../../common/auth-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PermissionsGuard, RequirePermission } from './permissions.guard.js';
import { AdminOperationsService } from './admin-operations.service.js';
import {
  AdminClubTierDto,
  AdminBlockCustomerDto,
  AdminEmployeeDto,
  AdminEmployeeRoleDto,
  AdminFreeDayDto,
  AdminLoyaltySettingsDto,
  AdminManualSubscriptionDto,
  AdminNotificationTemplateDto,
  AdminPromoCodeDto,
  AdminReviewModerationDto,
  AdminReferralTierDto,
  AdminSkipExceptionDto,
} from './admin.dto.js';
import { AdminGovernanceService } from './admin-governance.service.js';
import { AdminResourceService } from './admin-resource.service.js';
@Controller('staff')
@UseGuards(PermissionsGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: AdminOperationsService,
    private readonly governance: AdminGovernanceService,
    private readonly resources: AdminResourceService,
  ) {}
  @Get('me')
  @RequirePermission('staff.access')
  get(@CurrentAuth() auth: AuthContext) {
    return this.prisma.employee.findUniqueOrThrow({
      where: { userId: auth.userId },
      include: {
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
      },
    });
  }

  @Get('resources/:resource')
  @RequirePermission('staff.access')
  resource(
    @CurrentAuth() auth: AuthContext,
    @Param('resource') resource: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.resources.list(
      resource,
      auth.permissions ?? [],
      Number(page ?? 1),
      Number(pageSize ?? 25),
    );
  }

  @Get('dashboard')
  @RequirePermission('analytics.view')
  dashboard() {
    return this.governance.dashboard();
  }

  @Get('customers')
  @RequirePermission('users.view')
  customers(
    @Query('q') query?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
  ) {
    return this.governance.customers(
      query,
      Number(page ?? 1),
      Number(pageSize ?? 25),
      status,
    );
  }

  @Patch('customers/:id/block')
  @RequirePermission('users.edit')
  blockCustomer(
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id') id: string,
    @Body() dto: AdminBlockCustomerDto,
  ) {
    return this.governance.blockCustomer(
      auth.userId,
      auth.employeeId!,
      id,
      dto,
      requestId,
    );
  }

  @Get('roles')
  @RequirePermission('roles.manage')
  roles() {
    return this.governance.roles();
  }

  @Get('employees')
  @RequirePermission('employees.manage')
  employees() {
    return this.governance.employees();
  }

  @Post('employees')
  @RequirePermission('employees.manage')
  employee(@Body() dto: AdminEmployeeDto) {
    return this.governance.upsertEmployee(dto);
  }

  @Post('employees/:id/roles')
  @RequirePermission('roles.manage')
  assignRole(
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id') id: string,
    @Body() dto: AdminEmployeeRoleDto,
  ) {
    return this.governance.assignRole(
      auth.userId,
      auth.employeeId!,
      id,
      dto.roleCode,
      dto.reason,
      requestId,
    );
  }

  @Delete('employees/:id/roles')
  @RequirePermission('roles.manage')
  removeRole(
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id') id: string,
    @Body() dto: AdminEmployeeRoleDto,
  ) {
    return this.governance.removeRole(
      auth.userId,
      auth.employeeId!,
      id,
      dto.roleCode,
      dto.reason,
      requestId,
    );
  }

  @Get('audit-logs')
  @RequirePermission('audit.view')
  auditLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.governance.auditLogs(
      Number(page ?? 1),
      Number(pageSize ?? 50),
      entityType,
    );
  }

  @Get('reviews')
  @RequirePermission('reviews.manage')
  reviews(@Query('status') status?: never) {
    return this.governance.reviews(status);
  }

  @Patch('reviews/:id')
  @RequirePermission('reviews.manage')
  moderateReview(
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id') id: string,
    @Body() dto: AdminReviewModerationDto,
  ) {
    return this.governance.moderateReview(
      auth.userId,
      auth.employeeId!,
      id,
      dto,
      requestId,
    );
  }

  @Get('notification-templates')
  @RequirePermission('notifications.manage')
  templates() {
    return this.governance.templates();
  }

  @Post('notification-templates')
  @RequirePermission('notifications.manage')
  createTemplate(
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId: string,
    @Body() dto: AdminNotificationTemplateDto,
  ) {
    return this.governance.createTemplate(
      auth.userId,
      auth.employeeId!,
      dto,
      requestId,
    );
  }

  @Post('households/:id/subscriptions/manual')
  @RequirePermission('subscriptions.create')
  manualSubscription(
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId: string,
    @Param('id') id: string,
    @Body() dto: AdminManualSubscriptionDto,
  ) {
    return this.operations.manualSubscription(auth.userId, id, dto, requestId);
  }

  @Get('stage2-config')
  @RequirePermission('pricing.manage')
  async stage2Config() {
    const [pricing, cutoffs] = await Promise.all([
      this.prisma.pricingRuleSet.findMany({ orderBy: { version: 'desc' } }),
      this.prisma.cutoffPolicy.findMany({ orderBy: { version: 'desc' } }),
    ]);
    return { pricing, cutoffs };
  }

  @Get('stage4-config')
  @RequirePermission('loyalty.manage')
  async stage4Config() {
    const [settings, promos, referralTiers, clubTiers, addonCategories] =
      await Promise.all([
        this.prisma.loyaltySettings.findMany({ orderBy: { version: 'desc' } }),
        this.prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } }),
        this.prisma.referralTier.findMany({
          orderBy: { minQualifiedReferrals: 'asc' },
        }),
        this.prisma.clubTier.findMany({
          orderBy: { thresholdPaidCycles: 'asc' },
        }),
        this.prisma.addonCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
      ]);
    return { settings, promos, referralTiers, clubTiers, addonCategories };
  }

  @Get('stage5-config')
  @RequirePermission('delivery.manage')
  async stage5Config() {
    const [settings, zones, slots] = await Promise.all([
      this.prisma.deliverySettings.findMany({ orderBy: { version: 'desc' } }),
      this.prisma.deliveryZone.findMany({ orderBy: { version: 'desc' } }),
      this.prisma.deliverySlot.findMany({ orderBy: { sortOrder: 'asc' } }),
    ]);
    return {
      settings,
      zones,
      slots,
      warning:
        'DEMO geometry and simulator capabilities are forbidden in production. Slot deletion is not exposed; migrate referenced orders first.',
    };
  }

  @Post('stage4-config/settings')
  @RequirePermission('loyalty.manage')
  loyaltySettings(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: AdminLoyaltySettingsDto,
  ) {
    return this.operations.createLoyaltySettings(auth.userId, dto);
  }

  @Post('stage4-config/promos')
  @RequirePermission('loyalty.manage')
  promo(@CurrentAuth() auth: AuthContext, @Body() dto: AdminPromoCodeDto) {
    return this.operations.upsertPromo(auth.userId, dto);
  }

  @Post('stage4-config/referral-tiers')
  @RequirePermission('loyalty.manage')
  referralTier(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: AdminReferralTierDto,
  ) {
    return this.operations.upsertReferralTier(auth.userId, dto);
  }

  @Post('stage4-config/club-tiers')
  @RequirePermission('loyalty.manage')
  clubTier(@CurrentAuth() auth: AuthContext, @Body() dto: AdminClubTierDto) {
    return this.operations.upsertClubTier(auth.userId, dto);
  }

  @Post('subscriptions/:id/skip-exception')
  @RequirePermission('cutoff.override')
  skipException(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: AdminSkipExceptionDto,
  ) {
    return this.operations.skipException(auth.userId, id, dto);
  }

  @Post('subscriptions/:id/free-day')
  @RequirePermission('cutoff.override')
  freeDay(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: AdminFreeDayDto,
  ) {
    return this.operations.freeDay(auth.userId, id, dto);
  }
}
