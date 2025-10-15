import {
  Controller,
  Get,
  Query,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { RepaymentRecordsService } from './repayment-records.service';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { ManagementRoles } from '@prisma/client';

@Controller('repayment-records')
@UseGuards(AuthGuard, RolesGuard)
export class RepaymentRecordsController {
  constructor(
    private readonly repaymentRecordsService: RepaymentRecordsService,
  ) {}

  @Get()
  @Roles(ManagementRoles.负责人, ManagementRoles.风控人, ManagementRoles.收款人)
  async findAll(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: any,
  ): Promise<ApiResponseDto> {
    const result = await this.repaymentRecordsService.findAllWithPagination(
      query,
      user.id,
    );
    const data = {
      ...result,
      data: result.data.map((r) => this.repaymentRecordsService.toResponse(r)),
    };
    return ResponseHelper.success(data, '获取还款记录成功');
  }

  @Get('user/:userId')
  @Roles(ManagementRoles.负责人, ManagementRoles.风控人, ManagementRoles.收款人)
  async findByUser(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() user: any,
  ): Promise<ApiResponseDto> {
    const records = await this.repaymentRecordsService.findByUserId(
      userId,
      user.id,
    );
    const data = records.map((r) => this.repaymentRecordsService.toResponse(r));
    return ResponseHelper.success(data, '获取用户还款记录成功');
  }

  @Get('loan/:loanId')
  @Roles(ManagementRoles.负责人, ManagementRoles.风控人, ManagementRoles.收款人)
  async findByLoan(
    @Param('loanId') loanId: string,
    @CurrentUser() user: any,
  ): Promise<ApiResponseDto> {
    const records = await this.repaymentRecordsService.findByLoanId(
      loanId,
      user.id,
    );
    const data = records.map((r) => this.repaymentRecordsService.toResponse(r));
    return ResponseHelper.success(data, '获取贷款还款记录成功');
  }
}
