import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VisitorsService } from '../visitors/visitors.service';

@Injectable()
export class VisitorsCronService {
  private readonly logger = new Logger(VisitorsCronService.name);

  constructor(private readonly visitorsService: VisitorsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyVisitorStatsCalculation() {
    this.logger.log('🕛 开始执行每日访客统计数据计算任务');

    try {
      // 计算前一天的访客统计数据
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      await this.visitorsService.calculateDailyStats(yesterday);

      this.logger.log(
        `✅ 成功计算 ${yesterday.toISOString().split('T')[0]} 的访客统计数据`,
      );
    } catch (error) {
      this.logger.error('❌ 每日访客统计数据计算失败:', error);
    }
  }

  @Cron('0 1 * * *') // 每天凌晨1点执行
  async handleMissingVisitorStatsCalculation() {
    this.logger.log('🔄 开始检查并计算缺失的访客统计数据');

    try {
      // 检查最近30天是否有缺失的访客统计数据
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      await this.visitorsService.calculateMissingStats(startDate, endDate);

      this.logger.log('✅ 缺失访客统计数据检查完成');
    } catch (error) {
      this.logger.error('❌ 缺失访客统计数据计算失败:', error);
    }
  }
}
