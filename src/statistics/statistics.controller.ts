import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { StatisticsService } from './statistics.service';
import { GetStatisticsDto } from './dto/get-statistics.dto';
import { CalculateStatisticsDto } from './dto/calculate-statistics.dto';
import { AuthGuard } from '../auth/auth.guard';
import { ResponseHelper } from 'src/common/response-helper';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('statistics')
@UseGuards(AuthGuard)
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get()
  async getStatistics(@Query() query: GetStatisticsDto) {
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
