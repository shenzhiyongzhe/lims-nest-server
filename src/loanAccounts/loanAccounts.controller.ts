import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  BadRequestException,
  // ConflictException,
  InternalServerErrorException,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { LoanAccountsService } from './loanAccounts.service';
import { CreateLoanAccountDto } from './dto/create-loanAccount.dto';
import { LoanAccount } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('loan-accounts')
@UseGuards(AuthGuard, RolesGuard)
export class LoanAccountsController {
  constructor(private readonly loanAccountsService: LoanAccountsService) {}

  @Get()
  async findAll(): Promise<LoanAccount[]> {
    return this.loanAccountsService.findAll();
  }

  @Get(':id')
  async findById(@Param('id', ParseIntPipe) id: number): Promise<LoanAccount> {
    const loan = await this.loanAccountsService.findById(id);
    if (!loan) {
      throw new BadRequestException('贷款记录不存在');
    }
    return loan;
  }

  @Post()
  async create(
    @Body() body: CreateLoanAccountDto,
    @CurrentUser() user: { id: number },
  ): Promise<{ message: string; data: LoanAccount }> {
    try {
      const { due_start_date, total_periods, collector, payee } = body;

      if (!due_start_date || !total_periods || !collector || !payee) {
        throw new BadRequestException('缺少必要参数');
      }

      const createdBy = user.id;

      const loan = await this.loanAccountsService.create(body, createdBy);

      return {
        message: '创建成功',
        data: loan,
      };
    } catch (error: any) {
      console.error('创建贷款记录错误:', error);

      // if (error.code === 'P2002') {
      //   throw new ConflictException('手机号已存在');
      // }

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('服务器错误');
    }
  }
}
