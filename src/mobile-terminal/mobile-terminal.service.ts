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

    const allRiskControllerAssets =
      await this.prisma.riskControllerAssetManagement.findMany({
        select: {
          reduced_amount: true,
        },
      });
    const riskControllerTotalReduction = allRiskControllerAssets.reduce(
      (sum, asset) => sum + this.toNumber(asset.reduced_amount),
      0,
    );
    // 3. 计算剩余资金
    const remainingFunds =
      riskControllerTotalAmount -
      collectorTotalReduction -
      riskControllerTotalReduction;

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
        is_disabled: true,
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
        // 使用数据库聚合函数避免浮点数精度问题
        const monthlyStatsAggregate =
          await this.prisma.payeeDailyStatistics.aggregate({
            where: {
              payee_id: payee.id,
              date: {
                gte: monthStart,
                lte: monthEnd,
              },
            },
            _sum: {
              daily_total: true,
            },
          });

        const monthlyCollection = this.toNumber(
          monthlyStatsAggregate._sum.daily_total,
        );

        return {
          id: payee.id,
          username: payee.username,
          address: payee.address,
          today_collection: todayStats.daily_total,
          monthly_collection: monthlyCollection,
          remaining_limit: this.toNumber(payee.remaining_limit),
          is_disabled: payee.is_disabled,
        };
      }),
    );

    // 计算汇总统计 - 从 RepaymentRecord 查询
    // 数据库存储的是UTC时间，需要将上海时间（UTC+8）转换为UTC时间
    const UTC_OFFSET_HOURS = 8; // 上海时间与UTC的时差（小时）
    const UTC_OFFSET_MS = UTC_OFFSET_HOURS * 60 * 60 * 1000; // 转换为毫秒

    // 上海时间今天的开始和结束时间
    const shanghaiTodayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const shanghaiTodayEnd = new Date(shanghaiTodayStart);
    shanghaiTodayEnd.setHours(23, 59, 59, 999);

    // 转换为UTC时间（减去8小时）
    const todayStartUTC = new Date(
      shanghaiTodayStart.getTime() - UTC_OFFSET_MS,
    );
    const todayEndUTC = new Date(shanghaiTodayEnd.getTime() - UTC_OFFSET_MS);

    // 上海时间昨天的开始和结束时间
    const shanghaiYesterdayStart = new Date(shanghaiTodayStart);
    shanghaiYesterdayStart.setDate(shanghaiYesterdayStart.getDate() - 1);
    const shanghaiYesterdayEnd = new Date(shanghaiYesterdayStart);
    shanghaiYesterdayEnd.setHours(23, 59, 59, 999);

    // 转换为UTC时间（减去8小时）
    const yesterdayStartUTC = new Date(
      shanghaiYesterdayStart.getTime() - UTC_OFFSET_MS,
    );
    const yesterdayEndUTC = new Date(
      shanghaiYesterdayEnd.getTime() - UTC_OFFSET_MS,
    );

    // 上海时间本月的开始和结束时间
    const shanghaiMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const shanghaiMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    // 转换为UTC时间（减去8小时）
    const monthStartUTC = new Date(
      shanghaiMonthStart.getTime() - UTC_OFFSET_MS,
    );
    const monthEndUTC = new Date(shanghaiMonthEnd.getTime() - UTC_OFFSET_MS);

    // 本月总收款 - 从 RepaymentRecord 查询（使用UTC时间）
    // 使用数据库聚合函数避免浮点数精度问题
    const monthlyAggregate = await this.prisma.repaymentRecord.aggregate({
      where: {
        paid_at: {
          gte: monthStartUTC,
          lte: monthEndUTC,
        },
      },
      _sum: {
        paid_amount: true,
      },
      _count: {
        id: true,
      },
    });

    const monthlyTotal = this.toNumber(monthlyAggregate._sum.paid_amount);

    // 今日收款 - 从 RepaymentRecord 查询（使用UTC时间）
    // 使用数据库聚合函数避免浮点数精度问题
    const todayAggregate = await this.prisma.repaymentRecord.aggregate({
      where: {
        paid_at: {
          gte: todayStartUTC,
          lte: todayEndUTC,
        },
      },
      _sum: {
        paid_amount: true,
      },
    });

    const todayTotal = this.toNumber(todayAggregate._sum.paid_amount);

    // 昨日收款 - 从 RepaymentRecord 查询（使用UTC时间）
    // 使用数据库聚合函数避免浮点数精度问题
    const yesterdayAggregate = await this.prisma.repaymentRecord.aggregate({
      where: {
        paid_at: {
          gte: yesterdayStartUTC,
          lte: yesterdayEndUTC,
        },
      },
      _sum: {
        paid_amount: true,
      },
    });

    const yesterdayTotal = this.toNumber(yesterdayAggregate._sum.paid_amount);

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
