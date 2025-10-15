import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface StatisticsResult {
  todayCollection: number;
  monthCollection: number;
  yearCollection: number;
  totalHandlingFee: number;
  todayOverdueCount: number;
  todayPaidCount: number;
  todayPendingCount: number;
  totalBorrowedUsers: number;
  settledUsers: number;
  unsettledUsers: number;
}

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatistics(
    adminId: number,
    role: string,
  ): Promise<StatisticsResult> {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(6, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // 构建基础查询条件（根据角色过滤）
    const loanAccountWhere = await this.buildLoanAccountFilter(adminId, role);

    console.log(`todayStart: ${todayStart}`);
    console.log(`todayEnd: ${todayEnd}`);

    // 并行执行所有查询以提高性能
    const [
      todayCollection,
      monthCollection,
      yearCollection,
      totalHandlingFee,
      todayOverdueCount,
      todayPaidCount,
      todayPendingCount,
      borrowedUsers,
      settledUsers,
    ] = await Promise.all([
      this.getCollectionAmount(loanAccountWhere, todayStart, todayEnd),
      this.getCollectionAmount(loanAccountWhere, monthStart, todayEnd),
      this.getCollectionAmount(loanAccountWhere, yearStart, todayEnd),
      this.getTotalHandlingFee(loanAccountWhere),
      this.getTodayOverdueCount(loanAccountWhere, todayStart, todayEnd),
      this.getTodayPaidCount(loanAccountWhere, todayStart, todayEnd),
      this.getTodayPendingCount(loanAccountWhere, todayStart, todayEnd),
      this.getBorrowedUsersCount(loanAccountWhere),
      this.getSettledUsersCount(loanAccountWhere),
    ]);

    return {
      todayCollection,
      monthCollection,
      yearCollection,
      totalHandlingFee,
      todayOverdueCount,
      todayPaidCount,
      todayPendingCount,
      totalBorrowedUsers: borrowedUsers,
      settledUsers,
      unsettledUsers: borrowedUsers - settledUsers,
    };
  }

  private async buildLoanAccountFilter(adminId: number, role: string) {
    if (role === '管理员') {
      return {}; // 管理员查看所有数据
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { username: true },
    });
    const username = admin?.username || '';

    if (role === '收款人') {
      return { collector: username };
    }

    if (role === '风控人') {
      return { risk_controller: username };
    }

    return {};
  }

  private async getCollectionAmount(
    loanAccountWhere: any,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const result = await this.prisma.repaymentSchedule.aggregate({
      where: {
        status: 'paid',
        paid_at: {
          gte: startDate,
          lt: endDate,
        },
        loan_account: loanAccountWhere,
      },
      _sum: {
        paid_amount: true,
      },
    });
    return Number(result._sum.paid_amount || 0);
  }

  private async getTotalHandlingFee(loanAccountWhere: any): Promise<number> {
    const result = await this.prisma.loanAccount.aggregate({
      where: loanAccountWhere,
      _sum: {
        handling_fee: true,
      },
    });
    return Number(result._sum.handling_fee || 0);
  }

  private async getTodayOverdueCount(
    loanAccountWhere: any,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const overdueRecords = await this.prisma.overdueRecord.findMany({
      where: {
        overdue_date: {
          gte: startDate,
          lt: endDate,
        },
        schedule: {
          loan_account: loanAccountWhere,
        },
      },
      distinct: ['user_id'],
      select: { user_id: true },
    });
    return overdueRecords.length;
  }

  private async getTodayPaidCount(
    loanAccountWhere: any,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const paidSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        status: 'paid',
        paid_at: {
          gte: startDate,
          lt: endDate,
        },
        loan_account: loanAccountWhere,
      },
      distinct: ['loan_id'],
      select: {
        loan_account: {
          select: { user_id: true },
        },
      },
    });
    const uniqueUsers = new Set(
      paidSchedules.map((s) => s.loan_account.user_id),
    );
    return uniqueUsers.size;
  }

  private async getTodayPendingCount(
    loanAccountWhere: any,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const pendingSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        status: { in: ['pending', 'active'] },
        due_end_date: {
          gte: startDate,
          lte: endDate,
        },
        loan_account: loanAccountWhere,
      },
      distinct: ['loan_id'],
      select: {
        loan_account: {
          select: { user_id: true },
        },
      },
    });
    const uniqueUsers = new Set(
      pendingSchedules.map((s) => s.loan_account.user_id),
    );
    return uniqueUsers.size;
  }

  private async getBorrowedUsersCount(loanAccountWhere: any): Promise<number> {
    const users = await this.prisma.loanAccount.findMany({
      where: loanAccountWhere,
      distinct: ['user_id'],
      select: { user_id: true },
    });
    return users.length;
  }

  private async getSettledUsersCount(loanAccountWhere: any): Promise<number> {
    const allLoans = await this.prisma.loanAccount.findMany({
      where: loanAccountWhere,
      select: {
        user_id: true,
        total_periods: true,
        repaid_periods: true,
      },
    });

    const userLoans = new Map<
      number,
      Array<{ total: number; repaid: number }>
    >();
    for (const loan of allLoans) {
      if (!userLoans.has(loan.user_id)) {
        userLoans.set(loan.user_id, []);
      }
      userLoans.get(loan.user_id)!.push({
        total: loan.total_periods,
        repaid: loan.repaid_periods,
      });
    }

    let settledCount = 0;
    for (const [, loans] of userLoans) {
      const allSettled = loans.every((loan) => loan.repaid >= loan.total);
      if (allSettled) {
        settledCount++;
      }
    }

    return settledCount;
  }
}
