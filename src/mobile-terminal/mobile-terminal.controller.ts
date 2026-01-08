import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MobileTerminalService } from './mobile-terminal.service';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ManagementRoles } from '@prisma/client';
import { RepaymentRecordsService } from '../repayment-records/repayment-records.service';
import { PaginationQueryDto } from '../repayment-records/dto/pagination-query.dto';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('mobile-terminal')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ManagementRoles.ADMIN)
export class MobileTerminalController {
  constructor(
    private readonly mobileTerminalService: MobileTerminalService,
    private readonly repaymentRecordsService: RepaymentRecordsService,
  ) {}

  /**
   * 获取顶部统计数据
   */
  @Get('statistics')
  async getTopStatistics(): Promise<ApiResponseDto> {
    const statistics = await this.mobileTerminalService.getTopStatistics();
    return ResponseHelper.success(statistics, '获取统计数据成功');
  }

  /**
   * 获取收款用户列表及统计数据
   */
  @Get('payees')
  async getPayeeListWithStatistics(): Promise<ApiResponseDto> {
    const data = await this.mobileTerminalService.getPayeeListWithStatistics();
    return ResponseHelper.success(data, '获取收款用户列表成功');
  }

  /**
   * 获取收款记录
   * 支持日期筛选
   */
  @Get('repayment-records')
  async getRepaymentRecords(
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
    return ResponseHelper.success(data, '获取收款记录成功');
  }
}
