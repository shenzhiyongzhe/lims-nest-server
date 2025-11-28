import {
  Controller,
  Get,
  Param,
  NotFoundException,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  Body,
  Put,
  Query,
  Req,
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
import { OperationLogsInterceptor } from '../operation-logs/operation-logs.interceptor';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('repayment-schedules')
@UseGuards(AuthGuard, RolesGuard)
@UseInterceptors(OperationLogsInterceptor)
export class RepaymentSchedulesController {
  constructor(
    private readonly repaymentSchedulesService: RepaymentSchedulesService,
    private readonly loanAccountsService: LoanAccountsService,
  ) {}
  @Get('today/status')
  @Roles(ManagementRoles.负责人, ManagementRoles.风控人, ManagementRoles.收款人)
  async findByStatusToday(
    @Query('status') status: RepaymentScheduleStatus,
    @CurrentUser() user: { id: number; role: string },
  ): Promise<ApiResponseDto> {
    const schedules = await this.repaymentSchedulesService.findByStatusToday(
      status,
      user.id,
    );
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
  async update(
    @Body() data: any,
    @Req() request: any,
    @CurrentUser() user: { id: number; role: string },
  ): Promise<ApiResponseDto> {
    // 获取更新前的完整数据（用于操作日志）
    // 必须在更新操作之前查询，确保获取的是更新前的数据
    const oldSchedule = await this.repaymentSchedulesService.findById(data.id);
    if (!oldSchedule) {
      throw new NotFoundException('还款计划不存在');
    }

    // 将更新前的完整数据存储到 request 对象，供拦截器使用
    // 只存储必要的字段，避免存储关联数据
    // 使用深拷贝确保数据不会被后续操作修改
    request.oldData = JSON.parse(
      JSON.stringify({
        id: oldSchedule.id,
        loan_id: oldSchedule.loan_id,
        period: oldSchedule.period,
        due_start_date: oldSchedule.due_start_date,
        due_end_date: oldSchedule.due_end_date,
        due_amount: oldSchedule.due_amount,
        capital: oldSchedule.capital,
        interest: oldSchedule.interest,
        remaining_capital: oldSchedule.remaining_capital,
        remaining_interest: oldSchedule.remaining_interest,
        fines: oldSchedule.fines,
        status: oldSchedule.status,
        paid_amount: oldSchedule.paid_amount,
        paid_at: oldSchedule.paid_at,
      }),
    );

    // 处理日期和数值类型转换
    const updateData: any = {
      id: data.id,
    };

    // 处理日期字段：将日期字符串转换为 DateTime
    // 统一使用 6:00:00 作为时间，与项目其他部分保持一致
    if (data.due_end_date) {
      // 如果传入的是日期字符串（YYYY-MM-DD），转换为 DateTime
      if (
        typeof data.due_end_date === 'string' &&
        data.due_end_date.match(/^\d{4}-\d{2}-\d{2}$/)
      ) {
        // 解析日期字符串，设置为当天的 6:00:00（与项目其他部分保持一致）
        const [year, month, day] = data.due_end_date.split('-').map(Number);
        const date = new Date(year, month - 1, day, 6, 0, 0, 0);
        updateData.due_end_date = date;
      } else if (data.due_end_date instanceof Date) {
        updateData.due_end_date = data.due_end_date;
      } else {
        const date = new Date(data.due_end_date);
        date.setHours(6, 0, 0, 0);
        updateData.due_end_date = date;
      }
    }

    if (data.due_start_date) {
      if (
        typeof data.due_start_date === 'string' &&
        data.due_start_date.match(/^\d{4}-\d{2}-\d{2}$/)
      ) {
        const [year, month, day] = data.due_start_date.split('-').map(Number);
        const date = new Date(year, month - 1, day, 6, 0, 0, 0);
        updateData.due_start_date = date;
      } else if (data.due_start_date instanceof Date) {
        updateData.due_start_date = data.due_start_date;
      } else {
        const date = new Date(data.due_start_date);
        date.setHours(6, 0, 0, 0);
        updateData.due_start_date = date;
      }
    }

    if (data.paid_at) {
      if (
        typeof data.paid_at === 'string' &&
        data.paid_at.match(/^\d{4}-\d{2}-\d{2}$/)
      ) {
        const [year, month, day] = data.paid_at.split('-').map(Number);
        const date = new Date(year, month - 1, day, 6, 0, 0, 0);
        updateData.paid_at = date;
      } else if (data.paid_at instanceof Date) {
        updateData.paid_at = data.paid_at;
      } else {
        const date = new Date(data.paid_at);
        date.setHours(6, 0, 0, 0);
        updateData.paid_at = date;
      }
    }

    // 处理数值字段：确保转换为正确的类型
    if (data.fines !== undefined) {
      updateData.fines = Number(data.fines);
    }
    if (data.due_amount !== undefined) {
      updateData.due_amount = data.due_amount;
    }
    if (data.pay_capital !== undefined) {
      updateData.pay_capital = Number(data.pay_capital) || 0;
    }
    if (data.pay_interest !== undefined) {
      updateData.pay_interest = Number(data.pay_interest) || 0;
    }

    // 处理其他字段
    if (data.period !== undefined) {
      updateData.period = data.period;
    }
    if (data.loan_id !== undefined) {
      updateData.loan_id = data.loan_id;
    }

    // 执行更新操作
    const updatedSchedule = await this.repaymentSchedulesService.update(
      updateData,
      user?.id,
    );

    // 返回完整的更新后数据，以便操作日志拦截器记录 new_data
    // 只返回必要的字段，避免返回关联数据
    const responseData = {
      id: updatedSchedule.id,
      loan_id: updatedSchedule.loan_id,
      period: updatedSchedule.period,
      due_start_date: updatedSchedule.due_start_date,
      due_end_date: updatedSchedule.due_end_date,
      due_amount: updatedSchedule.due_amount,
      capital: updatedSchedule.capital,
      interest: updatedSchedule.interest,
      remaining_capital: updatedSchedule.remaining_capital,
      remaining_interest: updatedSchedule.remaining_interest,
      fines: updatedSchedule.fines,
      status: updatedSchedule.status,
      paid_amount: updatedSchedule.paid_amount,
      paid_at: updatedSchedule.paid_at,
    };

    return ResponseHelper.success(responseData, '更新还款计划成功');
  }
}
