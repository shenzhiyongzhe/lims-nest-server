import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { LoanAccountsService } from './loanAccounts.service';
import { CreateLoanAccountDto } from './dto/create-loanAccount.dto';
import { UpdateLoanAccountDto } from './dto/update-loanAccount.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ResponseHelper } from 'src/common/response-helper';
import { ApiResponseDto } from 'src/common/dto/api-response.dto';
import { Roles } from 'src/auth/roles.decorator';
import { LoanAccountStatus, ManagementRoles } from '@prisma/client';
import { OperationLogsInterceptor } from '../operation-logs/operation-logs.interceptor';
import type { Response } from 'express';

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
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(
    ManagementRoles.管理员,
    ManagementRoles.负责人,
    ManagementRoles.风控人,
    ManagementRoles.收款人,
  )
  @Get('grouped-by-user')
  async groupedByUser(
    @Query('status') status: LoanAccountStatus,
    @CurrentUser() user: { id: number; role: string },
  ): Promise<ApiResponseDto> {
    let statusArray: LoanAccountStatus[] = [];
    if (status) {
      if (status === 'unsettled') {
        statusArray = ['pending', 'active', 'overdue'];
      } else {
        statusArray = [status];
      }
    }
    const rows = await this.loanAccountsService.findGroupedByUser(
      statusArray,
      user.id,
    );
    return ResponseHelper.success(rows, '按用户分组获取成功');
  }

  @Get('user/:userId')
  async findByUser(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<ApiResponseDto> {
    const rows = await this.loanAccountsService.findByUserId(userId);
    return ResponseHelper.success(rows, '获取用户贷款记录成功');
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ManagementRoles.管理员)
  @Get('export/admin')
  async exportAdmin(@Res() res: Response) {
    const buffer = await this.loanAccountsService.exportAdminReport();
    const now = new Date();
    const fileName = `业务导出_${now.getFullYear()}${(now.getMonth() + 1)
      .toString()
      .padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(
        fileName,
      )}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.send(buffer);
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
      const { due_start_date, total_periods, collector_id, payee_id } = body;

      if (!due_start_date || !total_periods || !collector_id || !payee_id) {
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

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(ManagementRoles.管理员)
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateLoanAccountDto,
  ): Promise<ApiResponseDto> {
    try {
      const updated = await this.loanAccountsService.update(id, body);
      return ResponseHelper.success(updated, '更新贷款记录成功');
    } catch (error: any) {
      console.error('更新贷款记录错误:', error);
      return ResponseHelper.error(`更新贷款记录失败: ${error.message}`, 500);
    }
  }
}
