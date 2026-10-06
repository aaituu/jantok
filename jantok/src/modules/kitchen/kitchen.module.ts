import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { PermissionsGuard } from '../admin/permissions.guard.js';
import { InventoryService } from './inventory.service.js';
import { KitchenController } from './kitchen.controller.js';
import { KitchenService } from './kitchen.service.js';
import { PrintService } from './print.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [KitchenController],
  providers: [KitchenService, InventoryService, PrintService, PermissionsGuard],
  exports: [KitchenService, InventoryService, PrintService],
})
export class KitchenModule {}
