import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RepaymentScheduleStatus } from '@prisma/client';

@Injectable()
export class ScheduleStatusService {
  private readonly logger = new Logger(ScheduleStatusService.name);
  constructor(private readonly prisma: PrismaService) {}

  // 每5分钟检查一次还款计划的状态并更新（pending->active->overdue）
  // @Cron(CronExpression.EVERY_5_MINUTES)
  @Cron('0 6 * * *')
  async updateRepaymentScheduleStatuses() {
    const now = new Date();
    // 获取今天的开始时间（00:00:00）用于日期比较
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // 激活：已到达开始时间且未到结束时间
    // 对于 Date 类型，比较时使用当天的开始时间
    await this.prisma.repaymentSchedule.updateMany({
      where: {
        due_start_date: { lte: now },
        due_end_date: { gte: todayStart }, // 使用 >= 今天的开始时间来判断未过期
        status: { in: ['pending', 'active'] },
      },
      data: { status: 'active' as RepaymentScheduleStatus },
    });

    // 逾期：超过结束日期未支付（due_end_date < 今天的开始时间）
    await this.prisma.repaymentSchedule.updateMany({
      where: {
        due_end_date: { lt: todayStart }, // 使用 < 今天的开始时间来判断已过期
        status: { in: ['pending', 'active'] },
      },
      data: { status: 'overdue' as RepaymentScheduleStatus },
    });

    this.logger.log('Repayment schedules status updated');
  }
}
