import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StatisticsService } from '../statistics/statistics.service';

@Injectable()
export class StatisticsCronService {
  private readonly logger = new Logger(StatisticsCronService.name);

  constructor(private readonly statisticsService: StatisticsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyStatisticsCalculation() {
    this.logger.log('🕛 开始执行每日统计数据计算任务');

    try {
      // 计算前一天的统计数据
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      await this.statisticsService.calculateDailyStatistics(yesterday);

      this.logger.log(
        `✅ 成功计算 ${yesterday.toISOString().split('T')[0]} 的统计数据`,
      );
    } catch (error) {
      this.logger.error('❌ 每日统计数据计算失败:', error);
    }
  }

  @Cron('0 1 * * *') // 每天凌晨1点执行
  async handleMissingStatisticsCalculation() {
    this.logger.log('🔄 开始检查并计算缺失的统计数据');

    try {
      // 检查最近30天是否有缺失的统计数据
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      await this.statisticsService.calculateMissingStatistics(
        startDate,
        endDate,
      );

      this.logger.log('✅ 缺失统计数据检查完成');
    } catch (error) {
      this.logger.error('❌ 缺失统计数据计算失败:', error);
    }
  }
}
