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
    // 检查用户角色：collector和risk_controller只能获取当天数据，无需日期范围
    if (user.role === '负责人' || user.role === '风控人') {
      // 使用业务日期：6点后算当天，6点前算前一天
      const now = new Date();
      // 获取业务日期（6点前算前一天）
      const businessDate = new Date(now);
      if (now.getHours() < 6) {
        businessDate.setDate(now.getDate() - 1);
      }
      businessDate.setHours(0, 0, 0, 0);

      const existing = await this.statisticsService.checkStatisticsExists(
        user.id,
        businessDate,
      );
      if (!existing) {
        // 异步触发统计计算，不阻塞请求
        this.statisticsService
          .calculateDailyStatistics(businessDate)
          .catch((err) => {
            console.error('自动触发统计计算失败:', err);
          });
      }

      const statistics = await this.statisticsService.getCollectorStatistics(
        user.id,
      );
      return ResponseHelper.success([statistics], '统计数据获取成功');
    }

    // 管理员可以使用日期范围
    const { range = 'last_7_days', startDate, endDate } = query;

    let parsedStartDate: Date | undefined;
    let parsedEndDate: Date | undefined;

    if (startDate) {
      parsedStartDate = new Date(startDate);
    }
    if (endDate) {
      parsedEndDate = new Date(endDate);
    }

    const statistics = await this.statisticsService.getStatisticsWithDateRange(
      range,
      parsedStartDate,
      parsedEndDate,
    );
    return ResponseHelper.success(statistics, '统计数据获取成功');
  }

  @Get('admin')
  @UseGuards(RolesGuard)
  @Roles(ManagementRoles.管理员)
  async getAdminStatistics() {
    // getAdminStatistics 方法内部已经处理了数据不存在的情况
    // 如果数据不存在，会自动创建默认统计记录
    const statistics = await this.statisticsService.getAdminStatistics();
    return ResponseHelper.success(statistics, '管理员统计数据获取成功');
  }

  @Get('collector-report')
  async getCollectorReport(@CurrentUser() user: { id: number; role: string }) {
    const report = await this.statisticsService.getCollectorReport(user.id);
    return ResponseHelper.success(report, '收款人报表获取成功');
  }

  @Post('calculate')
  async calculateStatistics(@Body() body: CalculateStatisticsDto) {
    const { date } = body;
    const targetDate = new Date(date);

    await this.statisticsService.calculateDailyStatistics(targetDate);

    return ResponseHelper.success(
      `已计算 ${date} 的统计数据`,
      '统计数据计算成功',
    );
  }

  @Post('calculate-range')
  async calculateStatisticsRange(
    @Body() body: { startDate: string; endDate: string },
  ) {
    const { startDate, endDate } = body;
    const start = new Date(startDate);
    const end = new Date(endDate);

    await this.statisticsService.calculateMissingStatistics(start, end);

    return ResponseHelper.success(
      `已计算 ${startDate} 到 ${endDate} 的统计数据`,
      '统计数据计算成功',
    );
  }
}
