import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StatisticsService } from '../statistics/statistics.service';

@Injectable()
export class StatisticsCronService {
  private readonly logger = new Logger(StatisticsCronService.name);

  constructor(private readonly statisticsService: StatisticsService) {}

  @Cron('0 6 * * *') // 每天早上6点执行
  async handleDailyStatisticsCalculation() {
    this.logger.log('🕛 开始执行每日统计数据计算任务');

    try {
      // 计算前一天的统计数据（因为6点前的数据属于前一天）
      // 业务日期规则：6点后算当天，6点前算前一天
      // 定时任务在6点执行，此时应该计算前一天的完整数据
      const now = new Date();
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() - 1); // 前一天
      targetDate.setHours(0, 0, 0, 0);

      await this.statisticsService.calculateDailyStatistics(targetDate);

      this.logger.log(
        `✅ 成功计算 ${targetDate.toISOString().split('T')[0]} 的统计数据`,
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
