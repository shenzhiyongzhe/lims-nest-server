import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StatisticsService } from '../statistics/statistics.service';

@Injectable()
export class StatisticsCronService {
  private readonly logger = new Logger(StatisticsCronService.name);

  constructor(private readonly statisticsService: StatisticsService) {}

  // 程序启动时执行一次检查
  async onModuleInit() {
    this.logger.log(
      'StatisticsCronService initialized, running initial statistics save...',
    );
    await this.handleDailyStatisticsSave();
  }

  @Cron('59 23 * * *') // 每天晚上23:59执行（北京时间）
  async handleDailyStatisticsSave() {
    this.logger.log('🕕 开始执行每日统计数据保存任务');

    try {
      // 统计当天的数据（23:59执行时统计的是当天的数据）
      // 使用北京时间（UTC+8）计算日期
      const now = new Date();
      // 获取当前UTC时间戳，加上8小时得到北京时间
      const beijingTimestamp = now.getTime() + 8 * 60 * 60 * 1000;
      const beijingDate = new Date(beijingTimestamp);
      // 提取北京时间的年月日
      const year = beijingDate.getUTCFullYear();
      const month = beijingDate.getUTCMonth();
      const day = beijingDate.getUTCDate();
      // 创建UTC日期对象，但日期部分是北京时间的日期
      const today = new Date(Date.UTC(year, month, day));

      await this.statisticsService.saveDailyStatistics(today);

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      this.logger.log(`✅ 成功保存 ${dateStr} 的统计数据`);
    } catch (error) {
      this.logger.error('❌ 每日统计数据保存失败:', error);
    }
  }
}
