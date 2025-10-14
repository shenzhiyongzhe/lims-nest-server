import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OverdueService {
  private readonly logger = new Logger(OverdueService.name);
  constructor(private readonly prisma: PrismaService) {}

  // 每天 06:05 生成 OverdueRecord（schedule_id 去重）
  @Cron('5 6 * * *')
  async generateDailyOverdueRecords() {
    const today = new Date();
    today.setHours(6, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 找到所有处于 overdue 状态但还没有 overdueRecords 的还款计划
    const overdueSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        status: 'overdue',
      },

      select: {
        id: true,
        loan_id: true,
        loan_account: { select: { user_id: true, collector: true } },
      },
    });

    const existing = await this.prisma.overdueRecord.findMany({
      where: {
        overdue_date: { gte: today, lt: tomorrow },
      },
      select: { schedule_id: true },
    });
    const existingSet = new Set(existing.map((e) => e.schedule_id));

    const toCreate = overdueSchedules
      .filter((s) => !existingSet.has(s.id))
      .map((s) => ({
        schedule_id: s.id,
        user_id: 0, // 可按需扩充：通过 loan_id -> user_id
        loan_id: s.loan_id,
        collector: s.loan_account.collector,
        overdue_date: new Date(),
      }));

    if (toCreate.length > 0) {
      await this.prisma.overdueRecord.createMany({ data: toCreate });
      this.logger.log(`Created overdue records: ${toCreate.length}`);
    } else {
      this.logger.log('No overdue records to create today');
    }
  }
}
