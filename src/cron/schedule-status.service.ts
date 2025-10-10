import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RepaymentStatus } from '@prisma/client';

@Injectable()
export class ScheduleStatusService {
  private readonly logger = new Logger(ScheduleStatusService.name);
  constructor(private readonly prisma: PrismaService) {}

  // 每5分钟检查一次还款计划的状态并更新（pending->active->overdue/overtime）
  @Cron(CronExpression.EVERY_5_MINUTES)
  async updateRepaymentScheduleStatuses() {
    const now = new Date();

    // 激活：已到达开始时间且未到结束时间
    await this.prisma.repaymentSchedule.updateMany({
      where: {
        due_start_date: { lte: now },
        due_end_date: { gt: now },
        status: { in: ['pending', 'overtime'] },
      },
      data: { status: 'active' as RepaymentStatus },
    });

    // 逾期：超过结束时间未支付
    await this.prisma.repaymentSchedule.updateMany({
      where: {
        due_end_date: { lte: now },
        status: { in: ['pending', 'active'] },
      },
      data: { status: 'overdue' as RepaymentStatus },
    });

    // 超时（overtime）：到期当日但未付款，可根据业务调整，这里示例为到期前3小时标记
    const threeHoursLater = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    await this.prisma.repaymentSchedule.updateMany({
      where: {
        due_end_date: { lte: threeHoursLater, gt: now },
        status: 'active',
      },
      data: { status: 'overtime' as RepaymentStatus },
    });

    this.logger.log('Repayment schedules status updated');
  }
}
