import { Controller, Get, Query } from '@nestjs/common';
import { CurrentAuth, type AuthContext } from '../../common/auth-context.js';
import { MenuQueryDto } from './menu.dto.js';
import { MenuService } from './menu.service.js';

@Controller('menu')
export class MenuController {
  constructor(private readonly service: MenuService) {}

  @Get()
  weekly(@CurrentAuth() auth: AuthContext, @Query() query: MenuQueryDto) {
    return this.service.weekly(auth.userId, query.from);
  }
}
