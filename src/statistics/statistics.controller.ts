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
    @Query()
    query: GetStatisticsDto & {
      riskControllerId?: string;
      collectorId?: string;
      roleType?: string;
      adminId?: string;
    },
    @CurrentUser() user: { id: number; role: string },
  ) {
    // 管理员查询collector/risk_controller详细统计数据
    if (user.role === '管理员') {
      // 解析参数
      const roleType =
        (query.roleType as 'collector' | 'risk_controller') || 'collector';
      const adminId = query.adminId ? parseInt(query.adminId, 10) : undefined;

      const statistics =
        await this.statisticsService.getCollectorDetailedStatisticsForAdmin(
          user.id,
          roleType,
          undefined, // targetDate
          adminId,
        );
      return ResponseHelper.success(statistics, '统计数据获取成功');
    }

    // 检查用户角色：collector和risk_controller获取详细统计数据
    if (user.role === '负责人' || user.role === '风控人') {
      const roleType = user.role === '负责人' ? 'collector' : 'risk_controller';

      // 解析归属筛选参数
      const riskControllerId = query.riskControllerId
        ? parseInt(query.riskControllerId, 10)
        : undefined;
      const collectorId = query.collectorId
        ? parseInt(query.collectorId, 10)
        : undefined;

      const statistics =
        await this.statisticsService.getCollectorDetailedStatisticsForCollector(
          user.id,
          roleType,
          undefined, // targetDate
          riskControllerId,
          collectorId,
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
