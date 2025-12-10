import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RepaymentScheduleStatus } from '@prisma/client';

@Injectable()
export class ScheduleStatusService implements OnModuleInit {
  private readonly logger = new Logger(ScheduleStatusService.name);
  constructor(private readonly prisma: PrismaService) {}

  // 程序启动时执行一次检查
  async onModuleInit() {
    this.logger.log(
      'ScheduleStatusService initialized, running initial status check...',
    );
    await this.updateRepaymentScheduleStatuses();
  }

  // 每天早上6点检查一次还款计划的状态并更新（pending->active->overdue）
  @Cron('0 6 * * *')
  async updateRepaymentScheduleStatuses() {
    const now = new Date();

    // 获取今天的开始时间（00:00:00 UTC）用于日期比较
    // 使用 UTC 时间确保日期判断准确，不受服务器时区影响
    const todayStart = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );

    // 获取明天的开始时间（用于判断是否过期）
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);

    this.logger.log(
      `Updating repayment schedule statuses at ${now.toISOString()}, todayStart: ${todayStart.toISOString()}`,
    );

    // 激活：已到达开始时间（周期是一天，所以due_start_date是今天或之前）
    // 对于 Date 类型字段（@db.Date），Prisma 会将其作为 UTC 日期的 00:00:00 处理
    // 所以我们需要使用 UTC 日期进行比较
    const activeResult = await this.prisma.repaymentSchedule.updateMany({
      where: {
        due_start_date: { lte: now },
        paid_amount: { lt: 1 },
        status: { in: ['pending'] },
      },
      data: { status: 'active' as RepaymentScheduleStatus },
    });
    this.logger.log(`Activated ${activeResult.count} repayment schedules`);

    // 逾期：周期是一天，所以due_start_date + 1天 < 今天，即due_start_date < 昨天
    // 由于周期是一天，前天到期的就是昨天逾期
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);

    const overdueResult = await this.prisma.repaymentSchedule.updateMany({
      where: {
        due_start_date: { lt: yesterdayStart }, // 开始日期 < 昨天，表示已逾期（因为周期是一天）
        status: { in: ['pending', 'active'] },
      },
      data: { status: 'overdue' as RepaymentScheduleStatus },
    });
    this.logger.log(
      `Marked ${overdueResult.count} repayment schedules as overdue`,
    );

    this.logger.log('Repayment schedules status updated successfully');
  }
}
