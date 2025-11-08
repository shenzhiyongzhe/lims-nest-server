import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async calculateDailyStatistics(date: Date): Promise<void> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    console.log(`📊 计算 ${date.toISOString().split('T')[0]} 的统计数据`);

    // 1. 计算总收款金额（所有payee的收款）
    const totalPayeeResult = await this.prisma.repaymentRecord.aggregate({
      where: {
        paid_at: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      _sum: {
        paid_amount: true,
      },
      _count: {
        id: true,
      },
    });

    const payeeAmount = Number(totalPayeeResult._sum.paid_amount || 0);
    const transactionCount = totalPayeeResult._count.id;

    // 2. 获取collector相关的loan_ids
    const collectorLoans = await this.prisma.loanAccountRole.findMany({
      where: {
        role_type: 'collector',
      },
      select: {
        loan_account_id: true,
      },
    });

    const collectorLoanIds = collectorLoans.map((loan) => loan.loan_account_id);

    // 3. 计算collector收款金额
    let collectorAmount = 0;
    if (collectorLoanIds.length > 0) {
      const collectorResult = await this.prisma.repaymentRecord.aggregate({
        where: {
          loan_id: {
            in: collectorLoanIds,
          },
          paid_at: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
        _sum: {
          paid_amount: true,
        },
      });
      collectorAmount = Number(collectorResult._sum.paid_amount || 0);
    }

    // 4. 获取risk_controller相关的loan_ids
    const riskControllerLoans = await this.prisma.loanAccountRole.findMany({
      where: {
        role_type: 'risk_controller',
      },
      select: {
        loan_account_id: true,
      },
    });

    const riskControllerLoanIds = riskControllerLoans.map(
      (loan) => loan.loan_account_id,
    );

    // 5. 计算risk_controller收款金额
    let riskControllerAmount = 0;
    if (riskControllerLoanIds.length > 0) {
      const riskControllerResult = await this.prisma.repaymentRecord.aggregate({
        where: {
          loan_id: {
            in: riskControllerLoanIds,
          },
          paid_at: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
        _sum: {
          paid_amount: true,
        },
      });
      riskControllerAmount = Number(riskControllerResult._sum.paid_amount || 0);
    }

    const totalAmount = payeeAmount;

    console.log(`📈 统计结果:`, {
      date: date.toISOString().split('T')[0],
      totalAmount,
      payeeAmount,
      collectorAmount,
      riskControllerAmount,
      transactionCount,
    });

    // 6. 保存或更新统计数据
    await this.prisma.dailyStatistics.upsert({
      where: {
        date: startOfDay,
      },
      update: {
        total_amount: totalAmount,
        payee_amount: payeeAmount,
        collector_amount: collectorAmount,
        risk_controller_amount: riskControllerAmount,
        transaction_count: transactionCount,
        updated_at: new Date(),
      },
      create: {
        date: startOfDay,
        total_amount: totalAmount,
        payee_amount: payeeAmount,
        collector_amount: collectorAmount,
        risk_controller_amount: riskControllerAmount,
        transaction_count: transactionCount,
      },
    });

    console.log(`✅ ${date.toISOString().split('T')[0]} 统计数据已保存`);
  }

  async getStatistics(startDate: Date, endDate: Date) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const statistics = await this.prisma.dailyStatistics.findMany({
      where: {
        date: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    return statistics.map((stat) => ({
      date: stat.date.toISOString().split('T')[0],
      total_amount: Number(stat.total_amount),
      payee_amount: Number(stat.payee_amount),
      collector_amount: Number(stat.collector_amount),
      risk_controller_amount: Number(stat.risk_controller_amount),
      transaction_count: stat.transaction_count,
    }));
  }

  async getStatisticsWithDateRange(
    range: string,
    customStart?: Date,
    customEnd?: Date,
  ) {
    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;

    switch (range) {
      case 'last_7_days':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      case 'last_30_days':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 30);
        break;
      case 'last_90_days':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 90);
        break;
      case 'custom':
        if (!customStart || !customEnd) {
          throw new Error('Custom date range requires start and end dates');
        }
        startDate = customStart;
        endDate = customEnd;
        break;
      default:
        // Default to last 7 days
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
    }

    return this.getStatistics(startDate, endDate);
  }

  async calculateMissingStatistics(
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      // 检查该日期是否已有统计数据
      const existing = await this.prisma.dailyStatistics.findUnique({
        where: {
          date: current,
        },
      });

      if (!existing) {
        console.log(
          `🔄 计算缺失的统计数据: ${current.toISOString().split('T')[0]}`,
        );
        await this.calculateDailyStatistics(new Date(current));
      }

      current.setDate(current.getDate() + 1);
    }
  }

  async getCollectorReport(adminId: number) {
    console.log(`📊 获取收款人报表: adminId=${adminId}`);

    // 1. 获取当前collector关联的loanAccount IDs
    const collectorLoanRoles = await this.prisma.loanAccountRole.findMany({
      where: {
        admin_id: adminId,
        role_type: 'collector',
      },
      select: {
        loan_account_id: true,
      },
    });

    const loanAccountIds = collectorLoanRoles.map(
      (role) => role.loan_account_id,
    );

    if (loanAccountIds.length === 0) {
      return {
        stats: null,
        groupedData: [],
        loanAccounts: [],
      };
    }

    // 2. 获取所有关联的LoanAccount及其用户信息
    const loanAccounts = await this.prisma.loanAccount.findMany({
      where: {
        id: {
          in: loanAccountIds,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            phone: true,
            address: true,
          },
        },
      },
      orderBy: {
        risk_controller: 'asc',
      },
    });

    // 3. 按risk_controller分组
    const groupedByRiskController = new Map<string, any[]>();
    const groupTotals = new Map<string, number>();

    loanAccounts.forEach((account) => {
      const riskController = account.risk_controller;
      if (!groupedByRiskController.has(riskController)) {
        groupedByRiskController.set(riskController, []);
        groupTotals.set(riskController, 0);
      }

      groupedByRiskController.get(riskController)!.push({
        id: account.id,
        user_id: account.user_id,
        user_name: account.user.username,
        user_phone: account.user.phone,
        user_address: account.user.address,
        loan_amount: Number(account.loan_amount),
        receiving_amount: Number(account.receiving_amount || 0),
        capital: Number(account.capital),
        interest: Number(account.interest),
        status: account.status,
        total_periods: account.total_periods,
        repaid_periods: account.repaid_periods,
        due_start_date: account.due_start_date,
        due_end_date: account.due_end_date,
        created_at: account.created_at,
      });

      const currentTotal = groupTotals.get(riskController)!;
      groupTotals.set(
        riskController,
        currentTotal + Number(account.receiving_amount || 0),
      );
    });

    // 4. 格式化分组数据
    const groupedData = Array.from(groupedByRiskController.entries()).map(
      ([riskController, accounts]) => ({
        risk_controller: riskController,
        total_receiving_amount: groupTotals.get(riskController) || 0,
        loan_count: accounts.length,
        accounts: accounts,
      }),
    );

    // 5. 计算总览统计数据（使用现有的统计方法获取Stats类型数据）
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // 今日收款
    const todayCollection = await this.prisma.repaymentRecord.aggregate({
      where: {
        loan_id: { in: loanAccountIds },
        paid_at: { gte: startOfToday },
      },
      _sum: { paid_amount: true },
    });

    // 本月收款
    const monthCollection = await this.prisma.repaymentRecord.aggregate({
      where: {
        loan_id: { in: loanAccountIds },
        paid_at: { gte: startOfMonth },
      },
      _sum: { paid_amount: true },
    });

    // 本年收款
    const yearCollection = await this.prisma.repaymentRecord.aggregate({
      where: {
        loan_id: { in: loanAccountIds },
        paid_at: { gte: startOfYear },
      },
      _sum: { paid_amount: true },
    });

    // 总手续费
    const totalHandlingFee = loanAccounts.reduce(
      (sum, account) => sum + Number(account.handling_fee),
      0,
    );

    // 今日事项统计
    const todaySchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: { in: loanAccountIds },
        due_end_date: {
          gte: startOfToday,
          lt: new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    });

    const todayOverdueCount = todaySchedules.filter(
      (s) => s.status === 'overdue',
    ).length;
    const todayPaidCount = todaySchedules.filter(
      (s) => s.status === 'paid',
    ).length;
    const todayPendingCount = todaySchedules.filter(
      (s) => s.status === 'pending' || s.status === 'active',
    ).length;

    // 用户统计
    const totalBorrowedUsers = new Set(loanAccounts.map((a) => a.user_id)).size;
    const settledUsers = new Set(
      loanAccounts.filter((a) => a.status === 'settled').map((a) => a.user_id),
    ).size;
    const unsettledUsers = totalBorrowedUsers - settledUsers;

    const stats = {
      todayCollection: Number(todayCollection._sum.paid_amount || 0),
      monthCollection: Number(monthCollection._sum.paid_amount || 0),
      yearCollection: Number(yearCollection._sum.paid_amount || 0),
      totalHandlingFee,
      todayOverdueCount,
      todayPaidCount,
      todayPendingCount,
      totalBorrowedUsers,
      settledUsers,
      unsettledUsers,
    };

    console.log(`✅ 收款人报表生成完成: ${groupedData.length} 个风控组`);

    return {
      stats,
      groupedData,
      loanAccounts: loanAccounts.map((account) => ({
        id: account.id,
        user_id: account.user_id,
        user_name: account.user.username,
        user_phone: account.user.phone,
        user_address: account.user.address,
        loan_amount: Number(account.loan_amount),
        receiving_amount: Number(account.receiving_amount || 0),
        capital: Number(account.capital),
        interest: Number(account.interest),
        status: account.status,
        risk_controller: account.risk_controller,
        total_periods: account.total_periods,
        repaid_periods: account.repaid_periods,
        due_start_date: account.due_start_date,
        due_end_date: account.due_end_date,
        created_at: account.created_at,
      })),
    };
  }
}
