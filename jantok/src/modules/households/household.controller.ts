import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentAuth, type AuthContext } from '../../common/auth-context.js';
import {
  AddressDto,
  CreateMemberDto,
  QuestionnaireDto,
  SelectServiceDayAddressDto,
  UpdateAddressDto,
} from './household.dto.js';
import { HouseholdService } from './household.service.js';

@Controller()
export class HouseholdController {
  constructor(private readonly service: HouseholdService) {}
  @Get('household') get(@CurrentAuth() auth: AuthContext) {
    return this.service.get(auth.userId);
  }
  @Post('household/members') member(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateMemberDto,
  ) {
    return this.service.createMember(auth.userId, dto);
  }
  @Put('household/members/:id/questionnaire') questionnaire(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: QuestionnaireDto,
  ) {
    return this.service.saveQuestionnaire(auth.userId, id, dto);
  }
  @Post('household/addresses') address(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: AddressDto,
  ) {
    return this.service.saveAddress(auth.userId, dto);
  }
  @Patch('household/addresses/:id') updateAddress(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.service.updateAddress(auth.userId, id, dto);
  }
  @Delete('household/addresses/:id') deleteAddress(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Query('version', ParseIntPipe) version: number,
  ) {
    return this.service.deleteAddress(auth.userId, id, version);
  }
  @Put('household/service-day-address') serviceDayAddress(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: SelectServiceDayAddressDto,
  ) {
    return this.service.selectServiceDayAddress(auth.userId, dto);
  }
  @Get('catalogs/questionnaire') catalogs() {
    return this.service.catalogs();
  }
}
