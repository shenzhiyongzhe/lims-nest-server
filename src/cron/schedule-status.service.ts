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

  // 每天早上6点检查一次还款计划的状态并更新（pending->overdue）
  @Cron('0 6 * * *')
  async updateRepaymentScheduleStatuses() {
    const now = new Date();

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

    // 更新所有受影响 loanAccount 的逾期数量
    // 查找所有有 overdue 状态还款计划的 loanAccount
    const overdueSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        status: 'overdue',
      },
      select: {
        loan_id: true,
      },
    });

    // 按 loan_id 分组，统计每个 loanAccount 的逾期数量
    const overdueCountByLoanId = new Map<string, number>();
    for (const schedule of overdueSchedules) {
      const count = overdueCountByLoanId.get(schedule.loan_id) || 0;
      overdueCountByLoanId.set(schedule.loan_id, count + 1);
    }

    // 批量更新所有 loanAccount 的 overdue_count
    for (const [loanId, overdueCount] of overdueCountByLoanId.entries()) {
      await this.prisma.loanAccount.update({
        where: { id: loanId },
        data: { overdue_count: overdueCount },
      });
    }

    this.logger.log(
      `Updated overdue_count for ${overdueCountByLoanId.size} loan accounts`,
    );

    this.logger.log('Repayment schedules status updated successfully');
  }
}
