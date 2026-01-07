import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取业务日期（从当天的 00:00:00 开始算）
   * @param date 基准日期，如果不提供则使用当前时间
   * @returns 业务日期（只包含日期部分，时间设为0点）
   */
  private getBusinessDate(date?: Date): Date {
    const now = date || new Date();
    const businessDate = new Date(now);

    // 设置时间为0点（从当天 00:00:00 开始算）
    businessDate.setHours(0, 0, 0, 0);
    return businessDate;
  }

  /**
   * 获取业务日期的开始时间（当天 00:00:00）
   * @param date 基准日期，如果不提供则使用当前时间
   * @returns 业务日期的开始时间（当天 00:00:00）
   */
  private getBusinessDayStart(date?: Date): Date {
    const businessDate = this.getBusinessDate(date);
    // 当天 00:00:00
    businessDate.setHours(0, 0, 0, 0);
    return businessDate;
  }

  /**
   * 获取业务日期的结束时间（当天 23:59:59.999）
   * @param date 基准日期，如果不提供则使用当前时间
   * @returns 业务日期的结束时间（当天 23:59:59.999）
   */
  private getBusinessDayEnd(date?: Date): Date {
    const businessDayStart = this.getBusinessDate(date);
    // 当天 23:59:59.999
    const businessDayEnd = new Date(businessDayStart);
    businessDayEnd.setHours(23, 59, 59, 999);
    return businessDayEnd;
  }

  // 获取collector/risk_controller的详细统计数据（管理员版本，包含昨日总金额和归属筛选）
  async getCollectorDetailedStatisticsForAdmin(
    adminId: number,
    roleType: 'collector' | 'risk_controller',
    targetDate?: Date,
    selectedAdminId?: number, // 管理员筛选某个collector或risk_controller时使用
  ): Promise<any> {
    // 如果指定了selectedAdminId，只查询该admin的数据
    if (selectedAdminId) {
      return this.getCollectorDetailedStatisticsInternal(
        selectedAdminId,
        roleType,
        targetDate,
        true, // 包含昨日总金额
        undefined, // 无归属筛选
        undefined,
      );
    }

    // 如果没有指定selectedAdminId，查询所有collector或risk_controller的总和
    if (roleType === 'collector') {
      return this.getAllCollectorsStatisticsSum(targetDate);
    } else if (roleType === 'risk_controller') {
      return this.getAllRiskControllersStatisticsSum(targetDate);
    }

    // 默认返回空数据
    const emptyStats: any = this.getEmptyStatistics();
    emptyStats.yesterdayTotalAmount = 0;
    return emptyStats;
  }

  // 获取所有collector统计数据的总和（管理员用）
  private async getAllCollectorsStatisticsSum(targetDate?: Date): Promise<any> {
    // 获取所有collector的admin_id
    const collectorRoles = await this.prisma.loanAccountRole.findMany({
      where: {
        role_type: 'collector',
      },
      select: {
        admin_id: true,
      },
      distinct: ['admin_id'],
    });

    const collectorAdminIds = collectorRoles.map((r) => r.admin_id);

    if (collectorAdminIds.length === 0) {
      // 如果没有collector，返回空数据
      const emptyStats: any = this.getEmptyStatistics();
      emptyStats.yesterdayTotalAmount = 0;
      return emptyStats;
    }

    // 对每个collector获取统计数据，然后求和
    const allStats = await Promise.all(
      collectorAdminIds.map((adminId) =>
        this.getCollectorDetailedStatisticsInternal(
          adminId,
          'collector',
          targetDate,
          true, // 包含昨日总金额
          undefined,
          undefined,
        ),
      ),
    );

    // 合并所有统计数据（求和）
    const sumStats = allStats.reduce(
      (acc, stats) => ({
        totalAmount: acc.totalAmount + (stats.totalAmount || 0),
        yesterdayTotalAmount:
          acc.yesterdayTotalAmount + (stats.yesterdayTotalAmount || 0),
        totalInStockAmount:
          acc.totalInStockAmount + (stats.totalInStockAmount || 0),
        totalFines: acc.totalFines + (stats.totalFines || 0),
        totalHandlingFee: acc.totalHandlingFee + (stats.totalHandlingFee || 0),
        totalNegotiatedCount:
          acc.totalNegotiatedCount + (stats.totalNegotiatedCount || 0),
        totalBlacklistCount:
          acc.totalBlacklistCount + (stats.totalBlacklistCount || 0),
        todayCollection: acc.todayCollection + (stats.todayCollection || 0),
        todayNewAmount: acc.todayNewAmount + (stats.todayNewAmount || 0),
        todaySettledAmount:
          acc.todaySettledAmount + (stats.todaySettledAmount || 0),
        todayNegotiatedCount:
          acc.todayNegotiatedCount + (stats.todayNegotiatedCount || 0),
        todayBlacklistCount:
          acc.todayBlacklistCount + (stats.todayBlacklistCount || 0),
        todayPaidCount: acc.todayPaidCount + (stats.todayPaidCount || 0),
        todayPendingCount:
          acc.todayPendingCount + (stats.todayPendingCount || 0),
        yesterdayOverdueCount:
          acc.yesterdayOverdueCount + (stats.yesterdayOverdueCount || 0),
        activeCount: acc.activeCount + (stats.activeCount || 0),
        yesterdayCollection:
          acc.yesterdayCollection + (stats.yesterdayCollection || 0),
        thisMonthNewAmount:
          acc.thisMonthNewAmount + (stats.thisMonthNewAmount || 0),
        thisMonthSettledAmount:
          acc.thisMonthSettledAmount + (stats.thisMonthSettledAmount || 0),
        thisMonthHandlingFee:
          acc.thisMonthHandlingFee + (stats.thisMonthHandlingFee || 0),
        thisMonthFines: acc.thisMonthFines + (stats.thisMonthFines || 0),
        thisMonthBlacklistCount:
          acc.thisMonthBlacklistCount + (stats.thisMonthBlacklistCount || 0),
        thisMonthNegotiatedCount:
          acc.thisMonthNegotiatedCount + (stats.thisMonthNegotiatedCount || 0),
        lastMonthHandlingFee:
          acc.lastMonthHandlingFee + (stats.lastMonthHandlingFee || 0),
        lastMonthFines: acc.lastMonthFines + (stats.lastMonthFines || 0),
        lastMonthBlacklistCount:
          acc.lastMonthBlacklistCount + (stats.lastMonthBlacklistCount || 0),
      }),
      {
        totalAmount: 0,
        yesterdayTotalAmount: 0,
        totalInStockAmount: 0,
        totalFines: 0,
        totalHandlingFee: 0,
        totalNegotiatedCount: 0,
        totalBlacklistCount: 0,
        todayCollection: 0,
        todayNewAmount: 0,
        todaySettledAmount: 0,
        todayNegotiatedCount: 0,
        todayBlacklistCount: 0,
        todayPaidCount: 0,
        todayPendingCount: 0,
        yesterdayOverdueCount: 0,
        activeCount: 0,
        yesterdayCollection: 0,
        thisMonthNewAmount: 0,
        thisMonthSettledAmount: 0,
        thisMonthHandlingFee: 0,
        thisMonthFines: 0,
        thisMonthBlacklistCount: 0,
        thisMonthNegotiatedCount: 0,
        lastMonthHandlingFee: 0,
        lastMonthFines: 0,
        lastMonthBlacklistCount: 0,
      },
    );

    return sumStats;
  }

  // 获取所有risk_controller统计数据的总和（管理员用）
  private async getAllRiskControllersStatisticsSum(
    targetDate?: Date,
  ): Promise<any> {
    // 获取所有risk_controller的admin_id
    const riskControllerRoles = await this.prisma.loanAccountRole.findMany({
      where: {
        role_type: 'risk_controller',
      },
      select: {
        admin_id: true,
      },
      distinct: ['admin_id'],
    });

    const riskControllerAdminIds = riskControllerRoles.map((r) => r.admin_id);

    if (riskControllerAdminIds.length === 0) {
      // 如果没有risk_controller，返回空数据
      const emptyStats: any = this.getEmptyStatistics();
      emptyStats.yesterdayTotalAmount = 0;
      return emptyStats;
    }

    // 对每个risk_controller获取统计数据，然后求和
    const allStats = await Promise.all(
      riskControllerAdminIds.map((adminId) =>
        this.getCollectorDetailedStatisticsInternal(
          adminId,
          'risk_controller',
          targetDate,
          true, // 包含昨日总金额
          undefined,
          undefined,
        ),
      ),
    );

    // 合并所有统计数据（求和）
    const sumStats = allStats.reduce(
      (acc, stats) => ({
        totalAmount: acc.totalAmount + (stats.totalAmount || 0),
        yesterdayTotalAmount:
          acc.yesterdayTotalAmount + (stats.yesterdayTotalAmount || 0),
        totalInStockAmount:
          acc.totalInStockAmount + (stats.totalInStockAmount || 0),
        totalFines: acc.totalFines + (stats.totalFines || 0),
        totalHandlingFee: acc.totalHandlingFee + (stats.totalHandlingFee || 0),
        totalNegotiatedCount:
          acc.totalNegotiatedCount + (stats.totalNegotiatedCount || 0),
        totalBlacklistCount:
          acc.totalBlacklistCount + (stats.totalBlacklistCount || 0),
        todayCollection: acc.todayCollection + (stats.todayCollection || 0),
        todayNewAmount: acc.todayNewAmount + (stats.todayNewAmount || 0),
        todaySettledAmount:
          acc.todaySettledAmount + (stats.todaySettledAmount || 0),
        todayNegotiatedCount:
          acc.todayNegotiatedCount + (stats.todayNegotiatedCount || 0),
        todayBlacklistCount:
          acc.todayBlacklistCount + (stats.todayBlacklistCount || 0),
        todayPaidCount: acc.todayPaidCount + (stats.todayPaidCount || 0),
        todayPendingCount:
          acc.todayPendingCount + (stats.todayPendingCount || 0),
        yesterdayOverdueCount:
          acc.yesterdayOverdueCount + (stats.yesterdayOverdueCount || 0),
        activeCount: acc.activeCount + (stats.activeCount || 0),
        yesterdayCollection:
          acc.yesterdayCollection + (stats.yesterdayCollection || 0),
        thisMonthNewAmount:
          acc.thisMonthNewAmount + (stats.thisMonthNewAmount || 0),
        thisMonthSettledAmount:
          acc.thisMonthSettledAmount + (stats.thisMonthSettledAmount || 0),
        thisMonthHandlingFee:
          acc.thisMonthHandlingFee + (stats.thisMonthHandlingFee || 0),
        thisMonthFines: acc.thisMonthFines + (stats.thisMonthFines || 0),
        thisMonthBlacklistCount:
          acc.thisMonthBlacklistCount + (stats.thisMonthBlacklistCount || 0),
        thisMonthNegotiatedCount:
          acc.thisMonthNegotiatedCount + (stats.thisMonthNegotiatedCount || 0),
        lastMonthHandlingFee:
          acc.lastMonthHandlingFee + (stats.lastMonthHandlingFee || 0),
        lastMonthFines: acc.lastMonthFines + (stats.lastMonthFines || 0),
        lastMonthBlacklistCount:
          acc.lastMonthBlacklistCount + (stats.lastMonthBlacklistCount || 0),
      }),
      {
        totalAmount: 0,
        yesterdayTotalAmount: 0,
        totalInStockAmount: 0,
        totalFines: 0,
        totalHandlingFee: 0,
        totalNegotiatedCount: 0,
        totalBlacklistCount: 0,
        todayCollection: 0,
        todayNewAmount: 0,
        todaySettledAmount: 0,
        todayNegotiatedCount: 0,
        todayBlacklistCount: 0,
        todayPaidCount: 0,
        todayPendingCount: 0,
        yesterdayOverdueCount: 0,
        activeCount: 0,
        yesterdayCollection: 0,
        thisMonthNewAmount: 0,
        thisMonthSettledAmount: 0,
        thisMonthHandlingFee: 0,
        thisMonthFines: 0,
        thisMonthBlacklistCount: 0,
        thisMonthNegotiatedCount: 0,
        lastMonthHandlingFee: 0,
        lastMonthFines: 0,
        lastMonthBlacklistCount: 0,
      },
    );

    return sumStats;
  }

  // 获取collector/risk_controller的详细统计数据（负责人/风控人版本，包含昨日总金额和归属筛选）
  async getCollectorDetailedStatisticsForCollector(
    adminId: number,
    roleType: 'collector' | 'risk_controller',
    targetDate?: Date,
    riskControllerId?: number, // 负责人筛选风控人时使用
    collectorId?: number, // 风控人筛选负责人时使用
  ): Promise<any> {
    return this.getCollectorDetailedStatisticsInternal(
      adminId,
      roleType,
      targetDate,
      true, // 包含昨日总金额
      riskControllerId,
      collectorId,
    );
  }

  // 内部方法：获取collector/risk_controller的详细统计数据
  private async getCollectorDetailedStatisticsInternal(
    adminId: number,
    roleType: 'collector' | 'risk_controller',
    targetDate?: Date,
    includeYesterdayTotal: boolean = false,
    riskControllerId?: number,
    collectorId?: number,
  ): Promise<any> {
    // 获取该admin相关的所有loan_account_ids
    let roles = await this.prisma.loanAccountRole.findMany({
      where: {
        admin_id: adminId,
        role_type: roleType,
      },
      select: {
        loan_account_id: true,
      },
    });

    let loanAccountIds = roles.map((r) => r.loan_account_id);

    // 归属筛选逻辑
    if (riskControllerId && roleType === 'collector') {
      // 负责人筛选风控人：只统计同时关联到当前负责人和指定风控人的loanAccount
      const riskControllerRoles = await this.prisma.loanAccountRole.findMany({
        where: {
          admin_id: riskControllerId,
          role_type: 'risk_controller',
          loan_account_id: { in: loanAccountIds },
        },
        select: {
          loan_account_id: true,
        },
      });
      const filteredLoanAccountIds = riskControllerRoles.map(
        (r) => r.loan_account_id,
      );
      loanAccountIds = filteredLoanAccountIds;
    } else if (collectorId && roleType === 'risk_controller') {
      // 风控人筛选负责人：只统计同时关联到当前风控人和指定负责人的loanAccount
      const collectorRoles = await this.prisma.loanAccountRole.findMany({
        where: {
          admin_id: collectorId,
          role_type: 'collector',
          loan_account_id: { in: loanAccountIds },
        },
        select: {
          loan_account_id: true,
        },
      });
      const filteredLoanAccountIds = collectorRoles.map(
        (r) => r.loan_account_id,
      );
      loanAccountIds = filteredLoanAccountIds;
    }

    if (loanAccountIds.length === 0) {
      // 如果没有关联的loan accounts，返回空数据
      const emptyStats: any = this.getEmptyStatistics();
      if (includeYesterdayTotal) {
        emptyStats.yesterdayTotalAmount = 0;
      }
      return emptyStats;
    }

    // 日期计算 - 如果传入了targetDate，使用它；否则使用当前日期
    const baseDate = targetDate || new Date();
    const now = baseDate;
    const todayStart = this.getBusinessDayStart(baseDate);
    const todayEnd = this.getBusinessDayEnd(baseDate);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayEnd);
    yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);

    // 本月第一天和最后一天
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    thisMonthStart.setHours(0, 0, 0, 0);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    nextMonthStart.setHours(0, 0, 0, 0);
    const thisMonthEnd = new Date(nextMonthStart);
    thisMonthEnd.setMilliseconds(thisMonthEnd.getMilliseconds() - 1);

    // 上个月第一天和最后一天
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    lastMonthStart.setHours(0, 0, 0, 0);
    const lastMonthEnd = new Date(thisMonthStart);
    lastMonthEnd.setMilliseconds(lastMonthEnd.getMilliseconds() - 1);

    // 前天（用于昨日逾期判断，因为周期是一天）
    const dayBeforeYesterdayStart = new Date(yesterdayStart);
    dayBeforeYesterdayStart.setDate(dayBeforeYesterdayStart.getDate() - 1);
    // 对于日期类型字段，使用今天的开始和明天的开始时间范围来精确匹配当天
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    // 总金额（所有相关LoanAccount的handling_fee + receiving_amount - company_cost总和）
    const allLoanAccounts = await this.prisma.loanAccount.findMany({
      where: {
        id: { in: loanAccountIds },
      },
      select: {
        loan_amount: true,
        handling_fee: true,
        total_fines: true,
        receiving_amount: true,
        company_cost: true,
      },
    });
    const totalAmount = allLoanAccounts.reduce(
      (sum, acc) =>
        sum +
        Number(acc.handling_fee || 0) +
        Number(acc.receiving_amount || 0) -
        Number(acc.company_cost || 0),
      0,
    );
    // 总在库金额（不包括已结清和黑名单）
    const inStockLoanAccounts = await this.prisma.loanAccount.findMany({
      where: {
        id: { in: loanAccountIds },
        status: {
          notIn: ['settled', 'blacklist'],
        },
      },
      select: { loan_amount: true },
    });
    const totalInStockAmount = inStockLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.loan_amount),
      0,
    );
    //总手续费
    const totalHandlingFee = allLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.handling_fee),
      0,
    );

    // 总罚金
    const totalFines = allLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.total_fines),
      0,
    );
    // 总黑名单
    const totalBlacklistCount = await this.prisma.loanAccount.count({
      where: {
        id: { in: loanAccountIds },
        status: 'blacklist',
      },
    });
    // 总协商中
    const totalNegotiatedCount = await this.prisma.loanAccount.count({
      where: {
        id: { in: loanAccountIds },
        status: 'negotiated',
      },
    });
    // 总在库人数（状态为pending或negotiated）
    const totalInStockCount = await this.prisma.loanAccount.count({
      where: {
        id: { in: loanAccountIds },
        status: {
          in: ['pending', 'negotiated'],
        },
      },
    });
    // 总收金额（所有LoanAccount的receiving_amount总和）
    const totalReceivedAmount = allLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.receiving_amount || 0),
      0,
    );
    //今日统计
    // 今日收款
    const todayRepaymentRecords = await this.prisma.repaymentRecord.findMany({
      where: {
        loan_id: { in: loanAccountIds },
        paid_at: {
          gte: todayStart,
          lte: todayEnd, // DateTime类型字段，使用今天结束时间
        },
      },
      select: { paid_amount: true },
    });
    const todayCollection = todayRepaymentRecords.reduce(
      (sum, record) => sum + Number(record.paid_amount || 0),
      0,
    );
    // 昨日收款
    const yesterdayRepaymentRecords =
      await this.prisma.repaymentRecord.findMany({
        where: {
          loan_id: { in: loanAccountIds },
          paid_at: {
            gte: yesterdayStart,
            lt: todayStart,
          },
        },
        select: { paid_amount: true },
      });
    const yesterdayCollection = yesterdayRepaymentRecords.reduce(
      (sum, record) => sum + Number(record.paid_amount || 0),
      0,
    );
    // 今日新增在库
    const todayNewLoanAccounts = await this.prisma.loanAccount.findMany({
      where: {
        id: { in: loanAccountIds },
        due_start_date: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
      select: { loan_amount: true },
    });
    const todayNewAmount = todayNewLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.loan_amount),
      0,
    );
    // 今日已还清
    const todaySettledLoanAccounts = await this.prisma.loanAccount.findMany({
      where: {
        id: { in: loanAccountIds },
        status: 'settled',
        due_end_date: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
      select: { loan_amount: true },
    });
    const todaySettledAmount = todaySettledLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.loan_amount),
      0,
    );
    // 今日已还清
    const todayPaidSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: { in: loanAccountIds },
        due_start_date: {
          gte: todayStart,
          lte: todayEnd,
        },
        status: 'paid',
      },
      select: { id: true },
    });
    const todayPaidCount = todayPaidSchedules.length;
    //今日待还款
    const todayPendingSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: { in: loanAccountIds },
        due_start_date: {
          gte: todayStart,
          lt: todayEnd,
        },
        status: 'pending',
      },
      select: { id: true },
    });
    const todayPendingCount = todayPendingSchedules.length;
    //今日进行中
    const activeSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: { in: loanAccountIds },
        status: 'active',
      },
      select: { id: true },
    });
    const activeCount = activeSchedules.length;
    // 今日协商中

    const todayNegotiatedLoans = await this.prisma.loanAccount.findMany({
      where: {
        id: { in: loanAccountIds },
        status: 'negotiated',
        status_changed_at: {
          gte: todayStart,
          lte: todayEnd, // DateTime类型字段，使用今天结束时间
        },
      },
      select: { id: true },
    });
    const todayNegotiatedCount = todayNegotiatedLoans.length;
    //今日黑名单
    const todayBlacklistLoans = await this.prisma.loanAccount.findMany({
      where: {
        id: { in: loanAccountIds },
        status: 'blacklist',
        status_changed_at: {
          gte: todayStart,
          lte: todayEnd, // DateTime类型字段，使用今天结束时间
        },
      },
      select: { id: true },
    });
    const todayBlacklistCount = todayBlacklistLoans.length;
    // 今日待收（repaymentSchedule的due_start_date为今天，状态为pending或active的due_amount - paid_capital - paid_interest总和）
    const todayUnpaidSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: { in: loanAccountIds },
        due_start_date: {
          gte: todayStart,
          lt: tomorrowStart,
        },
        status: {
          in: ['pending', 'active'],
        },
      },
      select: {
        due_amount: true,
        paid_capital: true,
        paid_interest: true,
      },
    });
    const todayUnpaidAmount = todayUnpaidSchedules.reduce(
      (sum, schedule) =>
        sum +
        (Number(schedule.due_amount || 0) -
          Number(schedule.paid_capital || 0) -
          Number(schedule.paid_interest || 0)),
      0,
    );
    // 今日后扣（LoanAccount的created_at为今天的handling_fee总和）
    const todayHandlingFeeLoanAccounts = await this.prisma.loanAccount.findMany(
      {
        where: {
          id: { in: loanAccountIds },
          created_at: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
        select: { handling_fee: true },
      },
    );
    const todayHandlingFee = todayHandlingFeeLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.handling_fee || 0),
      0,
    );
    // 今日罚金（repaymentSchedule的due_start_date为今天的fines总和）
    const todayFinesSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: { in: loanAccountIds },
        due_start_date: {
          gte: todayStart,
          lt: tomorrowStart,
        },
      },
      select: { fines: true },
    });
    const todayFines = todayFinesSchedules.reduce(
      (sum, schedule) => sum + Number(schedule.fines || 0),
      0,
    );
    // 昨日逾期
    const yesterdayOverdueSchedules =
      await this.prisma.repaymentSchedule.findMany({
        where: {
          loan_id: { in: loanAccountIds },
          status: 'overdue',
          due_start_date: {
            gte: dayBeforeYesterdayStart,
            lt: yesterdayStart,
          },
        },
        select: { id: true },
      });
    const yesterdayOverdueCount = yesterdayOverdueSchedules.length;

    // 本月新增
    const thisMonthNewLoanAccounts = await this.prisma.loanAccount.findMany({
      where: {
        id: { in: loanAccountIds },
        due_start_date: {
          gte: thisMonthStart,
          lt: nextMonthStart,
        },
      },
      select: { loan_amount: true },
    });
    const thisMonthNewAmount = thisMonthNewLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.loan_amount),
      0,
    );
    // 本月已还清
    const thisMonthSettledLoanAccounts = await this.prisma.loanAccount.findMany(
      {
        where: {
          id: { in: loanAccountIds },
          status: 'settled',
          due_end_date: {
            gte: thisMonthStart,
            lt: nextMonthStart,
          },
        },
        select: { loan_amount: true },
      },
    );
    const thisMonthSettledAmount = thisMonthSettledLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.loan_amount),
      0,
    );
    // 本月手续费
    const thisMonthLoanAccounts = await this.prisma.loanAccount.findMany({
      where: {
        id: { in: loanAccountIds },
        created_at: {
          gte: thisMonthStart,
          lte: thisMonthEnd, // DateTime类型字段，使用本月结束时间
        },
      },
      select: { handling_fee: true },
    });
    const thisMonthHandlingFee = thisMonthLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.handling_fee),
      0,
    );

    // 本月罚金
    const thisMonthRepaymentRecords =
      await this.prisma.repaymentRecord.findMany({
        where: {
          loan_id: { in: loanAccountIds },
          paid_at: {
            gte: thisMonthStart,
            lte: thisMonthEnd, // DateTime类型字段，使用本月结束时间
          },
        },
        select: { paid_fines: true },
      });
    const thisMonthFines = thisMonthRepaymentRecords.reduce(
      (sum, record) => sum + Number(record.paid_fines || 0),
      0,
    );
    //本月协商中
    const thisMonthNegotiatedCount = await this.prisma.loanAccount.count({
      where: {
        id: { in: loanAccountIds },
        status: 'negotiated',
        status_changed_at: {
          gte: thisMonthStart,
          lte: thisMonthEnd, // DateTime类型字段，使用本月结束时间
        },
      },
    });

    // 本月黑名单
    const thisMonthBlacklistCount = await this.prisma.loanAccount.count({
      where: {
        id: { in: loanAccountIds },
        status: 'blacklist',
        status_changed_at: {
          gte: thisMonthStart,
          lte: thisMonthEnd, // DateTime类型字段，使用本月结束时间
        },
      },
    });

    // 上个月手续费
    const lastMonthLoanAccounts = await this.prisma.loanAccount.findMany({
      where: {
        id: { in: loanAccountIds },
        created_at: {
          gte: lastMonthStart,
          lt: thisMonthStart,
        },
      },
      select: { handling_fee: true },
    });
    const lastMonthHandlingFee = lastMonthLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.handling_fee),
      0,
    );

    // 上个月罚金
    const lastMonthRepaymentRecords =
      await this.prisma.repaymentRecord.findMany({
        where: {
          loan_id: { in: loanAccountIds },
          paid_at: {
            gte: lastMonthStart,
            lt: thisMonthStart,
          },
        },
        select: { paid_fines: true },
      });
    const lastMonthFines = lastMonthRepaymentRecords.reduce(
      (sum, record) => sum + Number(record.paid_fines || 0),
      0,
    );

    // 上个月黑名单
    const lastMonthBlacklistCount = await this.prisma.loanAccount.count({
      where: {
        id: { in: loanAccountIds },
        status: 'blacklist',
        status_changed_at: {
          gte: lastMonthStart,
          lt: thisMonthStart,
        },
      },
    });
    // 获取昨日总金额（从 DailyStatistics 表查询）- 仅当需要时查询
    let yesterdayTotalAmount = 0;
    if (includeYesterdayTotal) {
      // 使用与保存时相同的日期格式：从baseDate获取日期字符串，然后减去1天
      const baseDateStr = baseDate.toISOString().split('T')[0];
      const [year, month, day] = baseDateStr.split('-').map(Number);
      // 创建日期对象并减去1天
      const yesterdayDate = new Date(Date.UTC(year, month - 1, day));
      yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
      // 格式化为日期字符串
      const yesterdayDateStr = `${yesterdayDate.getUTCFullYear()}-${String(yesterdayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getUTCDate()).padStart(2, '0')}`;
      // 使用与保存时相同的格式：T12:00:00.000Z
      const yesterdayDateForDb = new Date(yesterdayDateStr + 'T12:00:00.000Z');

      const yesterdayStatistics = await this.prisma.dailyStatistics.findUnique({
        where: {
          admin_id_date_role: {
            admin_id: adminId,
            date: yesterdayDateForDb,
            role: roleType,
          },
        },
        select: {
          total_amount: true,
        },
      });

      yesterdayTotalAmount = yesterdayStatistics
        ? Number(yesterdayStatistics.total_amount)
        : 0;
    }

    const result: any = {
      totalAmount,
      totalInStockAmount,
      totalHandlingFee,
      totalFines,
      totalBlacklistCount,
      totalNegotiatedCount,
      totalInStockCount,
      totalReceivedAmount,
      // 今日统计
      todayPaidCount,
      todayPendingCount,
      yesterdayOverdueCount,
      activeCount,
      todayNegotiatedCount,
      todayBlacklistCount,
      todayCollection,
      yesterdayCollection,
      todayNewAmount,
      todaySettledAmount,
      todayUnpaidAmount,
      todayHandlingFee,
      todayFines,
      // 本月统计
      thisMonthNewAmount,
      thisMonthSettledAmount,
      thisMonthHandlingFee,
      thisMonthFines,
      thisMonthNegotiatedCount,
      thisMonthBlacklistCount,
      // 上个月统计
      lastMonthHandlingFee,
      lastMonthFines,
      lastMonthBlacklistCount,
    };

    if (includeYesterdayTotal) {
      result.yesterdayTotalAmount = yesterdayTotalAmount;
    }

    return result;
  }

  // 保留原方法以保持向后兼容（内部调用新方法）
  async getCollectorDetailedStatistics(
    adminId: number,
    roleType: 'collector' | 'risk_controller',
    targetDate?: Date,
  ): Promise<any> {
    return this.getCollectorDetailedStatisticsForCollector(
      adminId,
      roleType,
      targetDate,
    );
  }

  private getEmptyStatistics() {
    return {
      totalAmount: 0,
      totalInStockAmount: 0,
      totalHandlingFee: 0,
      totalFines: 0,
      totalBlacklistCount: 0,
      totalNegotiatedCount: 0,
      totalInStockCount: 0,
      totalReceivedAmount: 0,
      // 今日统计
      todayPaidCount: 0,
      todayPendingCount: 0,
      yesterdayOverdueCount: 0,
      activeCount: 0,
      todayNegotiatedCount: 0,
      todayBlacklistCount: 0,
      todayCollection: 0,
      yesterdayCollection: 0,
      todayNewAmount: 0,
      todaySettledAmount: 0,
      todayUnpaidAmount: 0,
      todayHandlingFee: 0,
      todayFines: 0,
      // 本月统计
      thisMonthNewAmount: 0,
      thisMonthSettledAmount: 0,
      thisMonthHandlingFee: 0,
      thisMonthFines: 0,
      thisMonthNegotiatedCount: 0,
      thisMonthBlacklistCount: 0,
      // 上个月统计
      lastMonthHandlingFee: 0,
      lastMonthFines: 0,
      lastMonthBlacklistCount: 0,
    };
  }

  // 保存每日统计数据到 DailyStatistics 表
  async saveDailyStatistics(date: Date): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];
    const dateForDb = new Date(dateStr + 'T12:00:00.000Z');

    // 获取所有 collector 和 risk_controller 角色
    const roles = await this.prisma.loanAccountRole.findMany({
      where: {
        role_type: {
          in: ['collector', 'risk_controller'],
        },
      },
      include: {
        admin: {
          select: {
            id: true,
            username: true,
          },
        },
      },
      distinct: ['admin_id', 'role_type'],
    });

    // 按 admin_id + role_type 分组
    const adminRoleMap = new Map<
      string,
      { adminId: number; adminName: string; roleType: string }
    >();
    for (const role of roles) {
      const key = `${role.admin_id}_${role.role_type}`;
      if (!adminRoleMap.has(key)) {
        adminRoleMap.set(key, {
          adminId: role.admin_id,
          adminName: role.admin.username,
          roleType: role.role_type,
        });
      }
    }

    // 使用事务批量保存
    await this.prisma.$transaction(
      async (tx) => {
        for (const [, adminRole] of adminRoleMap.entries()) {
          // 获取统计数据
          const statistics = await this.getCollectorDetailedStatistics(
            adminRole.adminId,
            adminRole.roleType as 'collector' | 'risk_controller',
            date,
          );

          // 映射字段：camelCase -> snake_case
          await tx.dailyStatistics.upsert({
            where: {
              admin_id_date_role: {
                admin_id: adminRole.adminId,
                date: dateForDb,
                role: adminRole.roleType,
              },
            },
            create: {
              admin_id: adminRole.adminId,
              admin_name: adminRole.adminName,
              date: dateForDb,
              role: adminRole.roleType,
              // 总统计字段
              total_amount: statistics.totalAmount,
              total_in_stock_amount: statistics.totalInStockAmount,
              total_handling_fee: statistics.totalHandlingFee,
              total_fines: statistics.totalFines,
              total_blacklist_count: statistics.totalBlacklistCount,
              total_negotiated_count: statistics.totalNegotiatedCount,
              total_in_stock_count: statistics.totalInStockCount,
              total_received_amount: statistics.totalReceivedAmount,
              // 今日统计字段
              today_paid_count: statistics.todayPaidCount,
              today_pending_count: statistics.todayPendingCount,
              yesterday_overdue_count: statistics.yesterdayOverdueCount,
              active_count: statistics.activeCount,
              today_negotiated_count: statistics.todayNegotiatedCount,
              today_blacklist_count: statistics.todayBlacklistCount,
              today_collection: statistics.todayCollection,
              yesterday_collection: statistics.yesterdayCollection,
              today_new_amount: statistics.todayNewAmount,
              today_settled_amount: statistics.todaySettledAmount,
              today_unpaid_amount: statistics.todayUnpaidAmount,
              today_handling_fee: statistics.todayHandlingFee,
              today_fines: statistics.todayFines,
              // 本月统计字段
              this_month_new_amount: statistics.thisMonthNewAmount,
              this_month_settled_amount: statistics.thisMonthSettledAmount,
              this_month_handling_fee: statistics.thisMonthHandlingFee,
              this_month_fines: statistics.thisMonthFines,
              this_month_negotiated_count: statistics.thisMonthNegotiatedCount,
              this_month_blacklist_count: statistics.thisMonthBlacklistCount,
              // 上个月统计字段
              last_month_handling_fee: statistics.lastMonthHandlingFee,
              last_month_fines: statistics.lastMonthFines,
              last_month_blacklist_count: statistics.lastMonthBlacklistCount,
            },
            update: {
              // 总统计字段
              total_amount: statistics.totalAmount,
              total_in_stock_amount: statistics.totalInStockAmount,
              total_handling_fee: statistics.totalHandlingFee,
              total_fines: statistics.totalFines,
              total_blacklist_count: statistics.totalBlacklistCount,
              total_negotiated_count: statistics.totalNegotiatedCount,
              total_in_stock_count: statistics.totalInStockCount,
              total_received_amount: statistics.totalReceivedAmount,
              // 今日统计字段
              today_paid_count: statistics.todayPaidCount,
              today_pending_count: statistics.todayPendingCount,
              yesterday_overdue_count: statistics.yesterdayOverdueCount,
              active_count: statistics.activeCount,
              today_negotiated_count: statistics.todayNegotiatedCount,
              today_blacklist_count: statistics.todayBlacklistCount,
              today_collection: statistics.todayCollection,
              yesterday_collection: statistics.yesterdayCollection,
              today_new_amount: statistics.todayNewAmount,
              today_settled_amount: statistics.todaySettledAmount,
              today_unpaid_amount: statistics.todayUnpaidAmount,
              today_handling_fee: statistics.todayHandlingFee,
              today_fines: statistics.todayFines,
              // 本月统计字段
              this_month_new_amount: statistics.thisMonthNewAmount,
              this_month_settled_amount: statistics.thisMonthSettledAmount,
              this_month_handling_fee: statistics.thisMonthHandlingFee,
              this_month_fines: statistics.thisMonthFines,
              this_month_negotiated_count: statistics.thisMonthNegotiatedCount,
              this_month_blacklist_count: statistics.thisMonthBlacklistCount,
              // 上个月统计字段
              last_month_handling_fee: statistics.lastMonthHandlingFee,
              last_month_fines: statistics.lastMonthFines,
              last_month_blacklist_count: statistics.lastMonthBlacklistCount,
            },
          });
        }
      },
      {
        timeout: 60000, // 60秒超时
      },
    );
  }

  // 获取昨日统计数据
  async getYesterdayStatistics(
    adminId: number,
    roleType: 'collector' | 'risk_controller',
  ): Promise<any> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const dateStr = yesterday.toISOString().split('T')[0];
    const dateForDb = new Date(dateStr + 'T12:00:00.000Z');

    const statistics = await this.prisma.dailyStatistics.findUnique({
      where: {
        admin_id_date_role: {
          admin_id: adminId,
          date: dateForDb,
          role: roleType,
        },
      },
    });

    if (!statistics) {
      return this.getEmptyStatistics();
    }

    // 将数据库字段名转换为 camelCase
    return {
      totalAmount: Number(statistics.total_amount),
      totalInStockAmount: Number(statistics.total_in_stock_amount),
      totalHandlingFee: Number(statistics.total_handling_fee),
      totalFines: Number(statistics.total_fines),
      totalBlacklistCount: statistics.total_blacklist_count,
      totalNegotiatedCount: statistics.total_negotiated_count,
      totalInStockCount: statistics.total_in_stock_count,
      totalReceivedAmount: Number(statistics.total_received_amount),
      // 今日统计字段
      todayPaidCount: statistics.today_paid_count,
      todayPendingCount: statistics.today_pending_count,
      yesterdayOverdueCount: statistics.yesterday_overdue_count,
      activeCount: statistics.active_count,
      todayNegotiatedCount: statistics.today_negotiated_count,
      todayBlacklistCount: statistics.today_blacklist_count,
      todayCollection: Number(statistics.today_collection),
      yesterdayCollection: Number(statistics.yesterday_collection),
      todayNewAmount: Number(statistics.today_new_amount),
      todaySettledAmount: Number(statistics.today_settled_amount),
      todayUnpaidAmount: Number(statistics.today_unpaid_amount),
      todayHandlingFee: Number(statistics.today_handling_fee),
      todayFines: Number(statistics.today_fines),
      // 本月统计字段
      thisMonthNewAmount: Number(statistics.this_month_new_amount),
      thisMonthSettledAmount: Number(statistics.this_month_settled_amount),
      thisMonthHandlingFee: Number(statistics.this_month_handling_fee),
      thisMonthFines: Number(statistics.this_month_fines),
      thisMonthNegotiatedCount: statistics.this_month_negotiated_count,
      thisMonthBlacklistCount: statistics.this_month_blacklist_count,
      // 上个月统计字段
      lastMonthHandlingFee: Number(statistics.last_month_handling_fee),
      lastMonthFines: Number(statistics.last_month_fines),
      lastMonthBlacklistCount: statistics.last_month_blacklist_count,
    };
  }

  async getAdminStatistics(): Promise<any[]> {
    // 获取所有 collector 和 risk_controller 角色
    const roles = await this.prisma.loanAccountRole.findMany({
      where: {
        role_type: { in: ['collector', 'risk_controller'] },
      },
      include: {
        admin: {
          select: {
            id: true,
            username: true,
          },
        },
      },
      distinct: ['admin_id', 'role_type'],
    });

    // 按 admin_id + role_type 分组（同一个admin可能同时是collector和risk_controller）
    const adminStatsMap = new Map<
      string,
      { adminId: number; adminName: string; roleType: string }
    >();

    for (const role of roles) {
      const key = `${role.admin_id}_${role.role_type}`;
      if (!adminStatsMap.has(key)) {
        adminStatsMap.set(key, {
          adminId: role.admin_id,
          adminName: role.admin.username,
          roleType: role.role_type,
        });
      }
    }

    // 对每个 admin 的每个角色，调用 getCollectorDetailedStatisticsForAdmin（管理员版本，不包含昨日总金额）
    const results: any[] = [];
    for (const [, adminRole] of adminStatsMap.entries()) {
      const statistics = await this.getCollectorDetailedStatisticsForAdmin(
        adminRole.adminId,
        adminRole.roleType as 'collector' | 'risk_controller',
      );
      const yesterdayStatistics = await this.getYesterdayStatistics(
        adminRole.adminId,
        adminRole.roleType as 'collector' | 'risk_controller',
      );
      // 添加 admin_id, admin_name, role 字段以保持向后兼容
      results.push({
        admin_id: adminRole.adminId,
        admin_name: adminRole.adminName,
        role: adminRole.roleType,
        ...statistics,
        yesterday_statistics: yesterdayStatistics,
      });
    }

    return results;
  }
}
