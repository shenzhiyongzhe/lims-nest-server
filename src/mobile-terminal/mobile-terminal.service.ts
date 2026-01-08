import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PayeeDailyStatisticsService } from '../payee-daily-statistics/payee-daily-statistics.service';

@Injectable()
export class MobileTerminalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payeeDailyStatisticsService: PayeeDailyStatisticsService,
  ) {}

  /**
   * 将Prisma Decimal类型转换为number
   */
  private toNumber(value: any): number {
    if (value === null || value === undefined) {
      return 0;
    }
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const n = parseFloat(value);
      return Number.isNaN(n) ? 0 : n;
    }
    if (typeof value === 'object' && 'toNumber' in value) {
      try {
        return (value as any).toNumber();
      } catch {
        return parseFloat(String(value)) || 0;
      }
    }
    return parseFloat(String(value)) || 0;
  }

  /**
   * 获取顶部统计数据
   * 包括：风控人总金额、负责人总减资、剩余资金
   */
  async getTopStatistics() {
    // 1. 计算风控人总金额
    // 获取所有LoanAccount，计算handling_fee + receiving_amount - company_cost的总和
    const allLoanAccounts = await this.prisma.loanAccount.findMany({
      select: {
        handling_fee: true,
        receiving_amount: true,
        company_cost: true,
      },
    });

    const riskControllerTotalAmount = allLoanAccounts.reduce(
      (sum, account) =>
        sum +
        this.toNumber(account.handling_fee) +
        this.toNumber(account.receiving_amount) -
        this.toNumber(account.company_cost),
      0,
    );

    // 2. 计算负责人总减资
    // 获取所有CollectorAssetManagement，计算reduced_handling_fee + reduced_fines的总和
    const allCollectorAssets =
      await this.prisma.collectorAssetManagement.findMany({
        select: {
          reduced_handling_fee: true,
          reduced_fines: true,
        },
      });

    const collectorTotalReduction = allCollectorAssets.reduce(
      (sum, asset) =>
        sum +
        this.toNumber(asset.reduced_handling_fee) +
        this.toNumber(asset.reduced_fines),
      0,
    );

    // 3. 计算剩余资金
    const remainingFunds = riskControllerTotalAmount - collectorTotalReduction;

    return {
      risk_controller_total_amount: riskControllerTotalAmount,
      collector_total_reduction: collectorTotalReduction,
      remaining_funds: remainingFunds,
    };
  }

  /**
   * 获取收款用户列表及统计数据
   */
  async getPayeeListWithStatistics() {
    // 获取当前日期
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // 获取本月开始和结束日期
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    // 获取所有Payee
    const payees = await this.prisma.payee.findMany({
      select: {
        id: true,
        username: true,
        address: true,
        remaining_limit: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    // 获取所有Payee的统计数据
    const payeeListWithStats = await Promise.all(
      payees.map(async (payee) => {
        // 获取今日收款
        const todayStats =
          await this.payeeDailyStatisticsService.getDailyStatistics(
            payee.id,
            today,
          );

        // 获取本月收款（PayeeDailyStatistics中本月所有日期的daily_total总和）
        const monthlyStats = await this.prisma.payeeDailyStatistics.findMany({
          where: {
            payee_id: payee.id,
            date: {
              gte: monthStart,
              lte: monthEnd,
            },
          },
          select: {
            daily_total: true,
          },
        });

        const monthlyCollection = monthlyStats.reduce(
          (sum, stat) => sum + this.toNumber(stat.daily_total),
          0,
        );

        return {
          id: payee.id,
          username: payee.username,
          address: payee.address,
          today_collection: todayStats.daily_total,
          monthly_collection: monthlyCollection,
          remaining_limit: this.toNumber(payee.remaining_limit),
        };
      }),
    );

    // 计算汇总统计
    // 本月总收款
    const monthlyTotal = payeeListWithStats.reduce(
      (sum, payee) => sum + payee.monthly_collection,
      0,
    );

    // 今日收款
    const todayTotal = payeeListWithStats.reduce(
      (sum, payee) => sum + payee.today_collection,
      0,
    );

    // 昨日收款
    const yesterdayStats = await Promise.all(
      payees.map((payee) =>
        this.payeeDailyStatisticsService.getDailyStatistics(
          payee.id,
          yesterday,
        ),
      ),
    );
    const yesterdayTotal = yesterdayStats.reduce(
      (sum, stat) => sum + stat.daily_total,
      0,
    );

    return {
      payees: payeeListWithStats,
      summary: {
        monthly_total: monthlyTotal,
        today_total: todayTotal,
        yesterday_total: yesterdayTotal,
      },
    };
  }
}
