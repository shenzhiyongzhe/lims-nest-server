import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { LoanAccountsService } from './loanAccounts.service';
import { CreateLoanAccountDto } from './dto/create-loanAccount.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ResponseHelper } from 'src/common/response-helper';
import { ApiResponseDto } from 'src/common/dto/api-response.dto';
import { Roles } from 'src/auth/roles.decorator';
import { LoanAccountStatus, ManagementRoles } from '@prisma/client';
import { OperationLogsInterceptor } from '../operation-logs/operation-logs.interceptor';

@Controller('loan-accounts')
@UseInterceptors(OperationLogsInterceptor)
export class LoanAccountsController {
  constructor(private readonly loanAccountsService: LoanAccountsService) {}
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ManagementRoles.管理员)
  @Get()
  async findAll(): Promise<ApiResponseDto> {
    const loans = await this.loanAccountsService.findAll();
    return ResponseHelper.success(loans, '获取贷款记录成功');
  }
  @Roles(
    ManagementRoles.管理员,
    ManagementRoles.负责人,
    ManagementRoles.风控人,
    ManagementRoles.收款人,
  )
  @Get('grouped-by-user')
  async groupedByUser(
    @Query('status') status: LoanAccountStatus,
  ): Promise<ApiResponseDto> {
    let statusArray: LoanAccountStatus[] = [];
    if (status) {
      if (status === 'unsettled') {
        statusArray = ['pending', 'active', 'overdue'];
      } else {
        statusArray = [status];
      }
    }
    const rows = await this.loanAccountsService.findGroupedByUser(statusArray);
    return ResponseHelper.success(rows, '按用户分组获取成功');
  }

  @Get('user/:userId')
  async findByUser(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<ApiResponseDto> {
    const rows = await this.loanAccountsService.findByUserId(userId);
    return ResponseHelper.success(rows, '获取用户贷款记录成功');
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<ApiResponseDto> {
    const loan = await this.loanAccountsService.findById(id);
    if (!loan) {
      return ResponseHelper.error('贷款记录不存在', 400);
    }
    return ResponseHelper.success(loan, '获取贷款记录成功');
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Post()
  async create(
    @Body() body: CreateLoanAccountDto,
    @CurrentUser() user: { id: number },
  ): Promise<ApiResponseDto> {
    try {
      const { due_start_date, total_periods, collector, payee } = body;

      if (!due_start_date || !total_periods || !collector || !payee) {
        return ResponseHelper.error('缺少必要参数', 400);
      }

      const createdBy = user.id;

      const loan = await this.loanAccountsService.create(body, createdBy);

      return ResponseHelper.success(loan, '创建贷款记录成功');
    } catch (error: any) {
      console.error('创建贷款记录错误:', error);

      return ResponseHelper.error(`创建贷款记录失败: ${error.message}`, 500);
    }
  }
}
