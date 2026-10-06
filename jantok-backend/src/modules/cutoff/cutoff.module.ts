import { Global, Module } from '@nestjs/common';
import { CutoffService } from './cutoff.service.js';

@Global()
@Module({ providers: [CutoffService], exports: [CutoffService] })
export class CutoffModule {}
