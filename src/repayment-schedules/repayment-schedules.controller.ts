import {
  Controller,
  Get,
  Param,
  NotFoundException,
  ParseIntPipe,
  UseGuards,
  Body,
  Put,
} from '@nestjs/common';
import { RepaymentSchedulesService } from './repayment-schedules.service';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import type { RepaymentSchedule } from '@prisma/client';

@Controller('repayment-schedules')
@UseGuards(AuthGuard, RolesGuard)
export class RepaymentSchedulesController {
  constructor(
    private readonly repaymentSchedulesService: RepaymentSchedulesService,
  ) {}

  @Put()
  async update(@Body() data: RepaymentSchedule): Promise<ApiResponseDto> {
    const schedule = await this.repaymentSchedulesService.findById(data.id);
    if (!schedule) {
      throw new NotFoundException('还款计划不存在');
    }
    await this.repaymentSchedulesService.update(data);

    return ResponseHelper.success({ id: data.id }, '更新还款计划成功');
  }
  @Get('loan/:loanId')
  async findByLoanId(
    @Param('loanId', ParseIntPipe) loanId: number,
  ): Promise<ApiResponseDto> {
    const schedules = await this.repaymentSchedulesService.findByLoanId(loanId);

    if (schedules.length === 0) {
      throw new NotFoundException('该贷款记录暂无还款计划');
    }

    const data = schedules.map((schedule) =>
      this.repaymentSchedulesService.toResponse(schedule),
    );

    return ResponseHelper.success(data, '获取还款计划成功');
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
}
