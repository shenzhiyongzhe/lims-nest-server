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

    // 1. 首先处理 terminated 状态：查找所有符合条件的 loanAccount
    // 条件：status in [settled, blacklist] 且 early_settlement_capital > 0 且 status_changed_at != null
    const terminatedLoanAccounts = await this.prisma.loanAccount.findMany({
      where: {
        status: { in: ['settled', 'blacklist'] },
        early_settlement_capital: { gt: 0 },
        status_changed_at: { not: null },
      },
      select: {
        id: true,
        status_changed_at: true,
      },
    });
    // 将 status_changed_at 之后的还款计划状态改为 terminated
    let terminatedCount = 0;
    for (const loanAccount of terminatedLoanAccounts) {
      if (!loanAccount.status_changed_at) continue;

      // 将 status_changed_at 转换为只包含日期部分（去掉时间部分）
      // 因为 due_start_date 是日期类型，需要按日期比较
      const statusChangedDate = new Date(loanAccount.status_changed_at);
      statusChangedDate.setHours(0, 0, 0, 0);

      const result = await this.prisma.repaymentSchedule.updateMany({
        where: {
          loan_id: loanAccount.id,
          due_start_date: { gte: statusChangedDate },
          status: { not: 'terminated' }, // 只更新非 terminated 状态的
        },
        data: { status: 'terminated' as RepaymentScheduleStatus },
      });
      terminatedCount += result.count;
    }

    if (terminatedCount > 0) {
      this.logger.log(
        `Marked ${terminatedCount} repayment schedules as terminated`,
      );
    }

    const excludedLoanIds = terminatedLoanAccounts.map((la) => la.id);

    // 更新逾期状态，排除已结清或黑名单的 loanAccount
    const overdueWhere: any = {
      due_start_date: { lte: yesterdayStart },
      status: { in: ['pending'] },
    };

    if (excludedLoanIds.length > 0) {
      overdueWhere.loan_id = { notIn: excludedLoanIds };
    }

    const overdueResult = await this.prisma.repaymentSchedule.updateMany({
      where: overdueWhere,
      data: { status: 'overdue' as RepaymentScheduleStatus },
    });
    this.logger.log(
      `Marked ${overdueResult.count} repayment schedules as overdue`,
    );

    // 3. 更新所有受影响 loanAccount 的逾期数量
    // 查找所有有 overdue 状态还款计划的 loanAccount（排除 settled 和 blacklist）
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
