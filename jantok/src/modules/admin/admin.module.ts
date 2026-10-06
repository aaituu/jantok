import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { BootstrapService } from './bootstrap.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { AdminOperationsService } from './admin-operations.service.js';
import { AdminGovernanceService } from './admin-governance.service.js';
import { AdminResourceService } from './admin-resource.service.js';
@Module({
  controllers: [AdminController],
  providers: [
    BootstrapService,
    PermissionsGuard,
    AdminOperationsService,
    AdminGovernanceService,
    AdminResourceService,
  ],
})
export class AdminModule {}
