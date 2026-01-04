import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StatisticsService } from '../statistics/statistics.service';

@Injectable()
export class StatisticsCronService {
  private readonly logger = new Logger(StatisticsCronService.name);

  constructor(private readonly statisticsService: StatisticsService) {}

  @Cron('59 23 * * *') // 每天晚上23:59执行
  async handleDailyStatisticsSave() {
    this.logger.log('🕕 开始执行每日统计数据保存任务');

    try {
      // 统计当天的数据（23:59执行时统计的是当天的数据）
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      await this.statisticsService.saveDailyStatistics(today);

      this.logger.log(
        `✅ 成功保存 ${today.toISOString().split('T')[0]} 的统计数据`,
      );
    } catch (error) {
      this.logger.error('❌ 每日统计数据保存失败:', error);
    }
  }
}
