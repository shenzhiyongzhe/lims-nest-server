import {
  Controller,
  Get,
  Param,
  NotFoundException,
  ParseIntPipe,
  UseGuards,
  Body,
  Put,
  Query,
} from '@nestjs/common';
import { RepaymentSchedulesService } from './repayment-schedules.service';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ManagementRoles } from '@prisma/client';
import type {
  RepaymentSchedule,
  RepaymentScheduleStatus,
} from '@prisma/client';
import { LoanAccountsService } from '../loanAccounts/loanAccounts.service';

@Controller('repayment-schedules')
@UseGuards(AuthGuard, RolesGuard)
export class RepaymentSchedulesController {
  constructor(
    private readonly repaymentSchedulesService: RepaymentSchedulesService,
    private readonly loanAccountsService: LoanAccountsService,
  ) {}
  @Get('today/status')
  @Roles(ManagementRoles.负责人, ManagementRoles.风控人, ManagementRoles.收款人)
  async findByStatusToday(
    @Query('status') status: RepaymentScheduleStatus,
  ): Promise<ApiResponseDto> {
    const schedules =
      await this.repaymentSchedulesService.findByStatusToday(status);
    const data = schedules.map((schedule) =>
      this.repaymentSchedulesService.toResponse(schedule),
    );
    return ResponseHelper.success(data, '获取当天还款计划成功');
  }
  @Get('loan/:loanId')
  async findByLoanId(
    @Param('loanId', ParseIntPipe) loanId: string,
  ): Promise<ApiResponseDto> {
    const loan = await this.loanAccountsService.findById(loanId);
    return ResponseHelper.success(loan, '获取还款计划成功');
  }

  @Get(':id')
  async findById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiResponseDto> {
    const schedule = await this.repaymentSchedulesService.findById(id);

    if (!schedule) {
      throw new NotFoundException('还款计划不存在');
    }

    const data = this.repaymentSchedulesService.toResponse(schedule);
    return ResponseHelper.success(data, '获取还款计划成功');
  }
  @Put()
  async update(@Body() data: RepaymentSchedule): Promise<ApiResponseDto> {
    const schedule = await this.repaymentSchedulesService.findById(data.id);
    if (!schedule) {
      throw new NotFoundException('还款计划不存在');
    }
    await this.repaymentSchedulesService.update(data);

    return ResponseHelper.success({ id: data.id }, '更新还款计划成功');
  }
}
