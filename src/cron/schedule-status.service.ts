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

    // 激活：已到达开始时间且未到结束时间
    // 对于 Date 类型字段（@db.Date），Prisma 会将其作为 UTC 日期的 00:00:00 处理
    // 所以我们需要使用 UTC 日期进行比较
    const activeResult = await this.prisma.repaymentSchedule.updateMany({
      where: {
        due_start_date: { lte: now },
        due_end_date: { gte: todayStart, lt: tomorrowStart }, // 结束日期 >= 今天且 < 明天，表示未过期
        status: { in: ['pending', 'active'] },
      },
      data: { status: 'active' as RepaymentScheduleStatus },
    });
    this.logger.log(`Activated ${activeResult.count} repayment schedules`);

    // 逾期：超过结束日期未支付（due_end_date < 今天的开始时间）
    // 由于 due_end_date 是 Date 类型，存储为 UTC 00:00:00，所以直接与 todayStart 比较即可
    const overdueResult = await this.prisma.repaymentSchedule.updateMany({
      where: {
        due_end_date: { lt: todayStart }, // 结束日期 < 今天，表示已过期
        status: { in: ['pending'] },
      },
      data: { status: 'overdue' as RepaymentScheduleStatus },
    });
    this.logger.log(
      `Marked ${overdueResult.count} repayment schedules as overdue`,
    );

    this.logger.log('Repayment schedules status updated successfully');
  }
}
