import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { StatisticsService } from './statistics.service';
import { GetStatisticsDto } from './dto/get-statistics.dto';
import { CalculateStatisticsDto } from './dto/calculate-statistics.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ManagementRoles } from '@prisma/client';
import { ResponseHelper } from 'src/common/response-helper';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('statistics')
@UseGuards(AuthGuard)
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get()
  async getStatistics(
    @Query() query: GetStatisticsDto,
    @CurrentUser() user: { id: number; role: string },
  ) {
    // 检查用户角色：collector和risk_controller获取详细统计数据
    if (user.role === '负责人' || user.role === '风控人') {
      const roleType = user.role === '负责人' ? 'collector' : 'risk_controller';
      const statistics =
        await this.statisticsService.getCollectorDetailedStatistics(
          user.id,
          roleType,
        );
      return ResponseHelper.success(statistics, '统计数据获取成功');
    }
  }

  @Get('admin')
  @UseGuards(RolesGuard)
  @Roles(ManagementRoles.管理员, ManagementRoles.风控人, ManagementRoles.负责人)
  async getAdminStatistics() {
    // getAdminStatistics 方法内部已经处理了数据不存在的情况
    // 如果数据不存在，会自动创建默认统计记录
    const statistics = await this.statisticsService.getAdminStatistics();
    return ResponseHelper.success(statistics, '管理员统计数据获取成功');
  }
}
