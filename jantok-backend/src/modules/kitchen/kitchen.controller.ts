import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext } from '../../common/auth-context.js';
import {
  PermissionsGuard,
  RequirePermission,
} from '../admin/permissions.guard.js';
import {
  ConfirmProductionDto,
  GenerateProductionDto,
  InventoryMovementDto,
  PackingItemDto,
  PackingTaskDto,
  PrintDocumentDto,
  ProductionLineActualDto,
  ReceivePurchaseItemDto,
  SupplierDto,
  SupplierPurchaseDto,
  WasteDto,
} from './kitchen.dto.js';
import { InventoryService } from './inventory.service.js';
import { KitchenService } from './kitchen.service.js';
import { PrintService } from './print.service.js';

@Controller('staff/kitchen')
@UseGuards(PermissionsGuard)
export class KitchenController {
  constructor(
    private readonly kitchen: KitchenService,
    private readonly inventory: InventoryService,
    private readonly printing: PrintService,
  ) {}

  @Get('production')
  @RequirePermission('kitchen.manage')
  production(@Query('date') date: string) {
    return this.kitchen.list(date);
  }

  @Post('production/revisions')
  @RequirePermission('kitchen.manage')
  generate(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: GenerateProductionDto,
  ) {
    return this.kitchen.generate(auth.userId, dto);
  }

  @Put('production/lines/:id/actual')
  @RequirePermission('kitchen.manage')
  actual(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: ProductionLineActualDto,
  ) {
    return this.kitchen.recordActual(auth.userId, id, dto);
  }

  @Post('production/revisions/:id/confirm')
  @RequirePermission('kitchen.manage')
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: ConfirmProductionDto,
  ) {
    return this.kitchen.confirmProduction(auth.userId, id, dto);
  }

  @Post('packing/:id/start')
  @RequirePermission('kitchen.manage')
  startPacking(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: PackingTaskDto,
  ) {
    return this.kitchen.startPacking(auth.userId, id, dto);
  }

  @Put('packing/items/:id')
  @RequirePermission('kitchen.manage')
  packItem(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: PackingItemDto,
  ) {
    return this.kitchen.packItem(auth.userId, id, dto);
  }

  @Post('packing/:id/complete')
  @RequirePermission('kitchen.manage')
  completePacking(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: PackingTaskDto,
  ) {
    return this.kitchen.completePacking(auth.userId, id, dto);
  }

  @Get('inventory')
  @RequirePermission('inventory.manage')
  inventoryList() {
    return this.inventory.list();
  }

  @Get('suppliers')
  @RequirePermission('inventory.manage')
  suppliers() {
    return this.inventory.listSuppliers();
  }

  @Post('suppliers')
  @RequirePermission('inventory.manage')
  supplier(@Body() dto: SupplierDto) {
    return this.inventory.upsertSupplier(dto);
  }

  @Get('purchases')
  @RequirePermission('inventory.manage')
  purchases() {
    return this.inventory.listPurchases();
  }

  @Post('purchases')
  @RequirePermission('inventory.manage')
  purchase(@CurrentAuth() auth: AuthContext, @Body() dto: SupplierPurchaseDto) {
    return this.inventory.createPurchase(auth.userId, dto);
  }

  @Post('purchases/items/:id/receive')
  @RequirePermission('inventory.manage')
  receive(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseItemDto,
  ) {
    return this.inventory.receivePurchaseItem(auth.userId, id, dto);
  }

  @Post('inventory/waste')
  @RequirePermission('inventory.manage')
  waste(@CurrentAuth() auth: AuthContext, @Body() dto: WasteDto) {
    return this.inventory.recordWaste(auth.userId, dto);
  }

  @Post('inventory/movements')
  @RequirePermission('inventory.manage')
  movement(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: InventoryMovementDto,
  ) {
    return this.inventory.manualMovement(auth.userId, dto);
  }

  @Get('costs')
  @RequirePermission('inventory.manage')
  costs(@Query('from') from: string, @Query('to') to: string) {
    return this.inventory.costReport(from, to);
  }

  @Post('print')
  @RequirePermission('kitchen.manage')
  print(@CurrentAuth() auth: AuthContext, @Body() dto: PrintDocumentDto) {
    return this.printing.create(auth.userId, dto);
  }

  @Get('print/history')
  @RequirePermission('kitchen.manage')
  printHistory() {
    return this.printing.history();
  }

  @Get('print/:id/preview')
  @RequirePermission('kitchen.manage')
  async preview(@Param('id') id: string, @Res() response: Response) {
    response.type('text/html').send(await this.printing.htmlPreview(id));
  }

  @Get('print/:id/pdf')
  @RequirePermission('kitchen.manage')
  async pdf(@Param('id') id: string, @Res() response: Response) {
    const buffer = await this.printing.pdf(id);
    response.type('application/pdf').send(buffer);
  }
}
