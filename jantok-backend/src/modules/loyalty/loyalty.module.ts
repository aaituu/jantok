import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { LoyaltyController } from './loyalty.controller.js';
import { LoyaltyService } from './loyalty.service.js';
import { CutoffModule } from '../cutoff/cutoff.module.js';

@Global()
@Module({
  imports: [DatabaseModule, CutoffModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
