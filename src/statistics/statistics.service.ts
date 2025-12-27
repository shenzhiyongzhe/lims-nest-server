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

  async calculateDailyStatistics(date: Date): Promise<
    Array<{
      admin_id: number;
      admin_name: string;
      role: string;
      date: string;
      total_amount: number;
      payee_amount: number;
      receiving_amount: number;
      transaction_count: number;
    }>
  > {
    // 获取日期字符串（YYYY-MM-DD），避免时区问题
    const dateStr = date.toISOString().split('T')[0];

    // 构造一个UTC时间的Date对象用于保存到数据库（DATE类型）
    // 使用日期字符串 + 中午12点（UTC），这样无论什么时区，日期部分都是正确的
    const dateForDb = new Date(dateStr + 'T12:00:00.000Z');

    // 当天结束时刻（用于累计到当天为止的数据）
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    console.log(`📊 计算 ${dateStr} 的统计数据`);
    console.log(`  - dateForDb: ${dateForDb.toISOString()}`);

    // 1. 获取所有collector和risk_controller角色的loan_account_roles
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
            role: true,
          },
        },
        loan_account: {
          select: {
            id: true,
            receiving_amount: true,
          },
        },
      },
    });

    // 如果没有 roles，说明没有 loanAccounts，删除当天的统计数据并返回空数组
    if (roles.length === 0) {
      console.log(`⚠️ 没有找到任何 loan_account_roles，清理当天的统计数据`);
      // 删除当天的统计数据
      await this.prisma.$executeRaw`
        DELETE FROM daily_statistics
        WHERE DATE(date) = ${dateStr}
      `;
      console.log(`✅ 已清理 ${dateStr} 的统计数据`);
      return [];
    }

    // 2. 按admin_id分组，合并同一人在不同角色下的数据
    const adminStatsMap = new Map<
      number,
      {
        admin_id: number;
        admin_name: string;
        admin_role: string;
        loan_account_ids: Set<string>;
      }
    >();

    for (const role of roles) {
      const adminId = role.admin_id;
      const adminName = role.admin.username;
      const adminRole = role.admin.role;
      const loanAccountId = role.loan_account_id;

      if (!adminStatsMap.has(adminId)) {
        adminStatsMap.set(adminId, {
          admin_id: adminId,
          admin_name: adminName,
          admin_role: adminRole,
          loan_account_ids: new Set(),
        });
      }

      const stats = adminStatsMap.get(adminId)!;
      stats.loan_account_ids.add(loanAccountId);
    }

    // 3. 为每个admin统计相关的数据，并收集结果
    const results: Array<{
      admin_id: number;
      admin_name: string;
      role: string;
      date: string;
      total_amount: number;
      payee_amount: number;
      receiving_amount: number;
      transaction_count: number;
    }> = [];

    // 使用事务来确保所有操作的原子性
    await this.prisma.$transaction(
      async (tx) => {
        for (const [adminId, stats] of adminStatsMap.entries()) {
          const loanIds = Array.from(stats.loan_account_ids);

          // 查询所有相关的repayment_schedules
          const allSchedules = await tx.repaymentSchedule.findMany({
            where: {
              loan_id: {
                in: loanIds,
              },
            },
            select: {
              due_amount: true,
              paid_amount: true,
              status: true,
              paid_at: true,
            },
          });

          // 计算累计已还金额（从repayment_schedules统计）
          let payeeAmount = 0;
          let transactionCount = 0;
          let receivingAmount = 0;

          for (const schedule of allSchedules) {
            const dueAmount = Number(schedule.due_amount || 0);
            const paidAmount = Number(schedule.paid_amount || 0);

            // 累计已还金额
            if (paidAmount > 0) {
              payeeAmount += paidAmount;
            }

            // 统计已还清的记录数（status为paid或paid_amount大于0）
            if (schedule.status === 'paid' || paidAmount > 0) {
              transactionCount++;
            }

            // 计算累计应收金额（未还清的部分）
            const remaining = dueAmount - paidAmount;
            if (remaining > 0) {
              receivingAmount += remaining;
            }
          }

          const totalAmount = payeeAmount + receivingAmount;

          console.log(`📈 ${stats.admin_name}(${adminId}) 统计结果:`, {
            date: date.toISOString().split('T')[0],
            totalAmount,
            payeeAmount,
            receivingAmount,
            transactionCount,
            schedulesCount: allSchedules.length,
          });

          // 收集结果
          results.push({
            admin_id: adminId,
            admin_name: stats.admin_name,
            role: stats.admin_role,
            date: dateStr,
            total_amount: totalAmount,
            payee_amount: payeeAmount,
            receiving_amount: receivingAmount,
            transaction_count: transactionCount,
          });

          // 4. 注意：此方法使用旧的统计字段结构，已不再写入数据库
          // 新的统计方法请使用 getTodayAdminStatistics
          // 这里只返回计算结果，不写入数据库
          console.log(
            `⚠️ calculateDailyStatistics 使用旧字段结构，已弃用。请使用 getTodayAdminStatistics 方法。`,
          );
        }
      },
      {
        // 设置事务超时时间为30秒
        timeout: 30000,
      },
    );

    console.log(`✅ ${dateStr} 统计数据已保存，返回 ${results.length} 条记录`);
    return results;
  }

  async getStatistics(startDate: Date, endDate: Date) {
    const start = new Date(startDate);
    start.setHours(6, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(5, 59, 59, 999);

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

    // 返回新字段结构的数据
    return statistics.map((stat) => ({
      admin_id: stat.admin_id,
      admin_name: stat.admin_name,
      date: stat.date.toISOString().split('T')[0],
      role: stat.role,
      new_in_stock_amount: Number(stat.new_in_stock_amount),
      cleared_off_amount: Number(stat.cleared_off_amount),
      total_received: Number(stat.total_received),
      total_unpaid: Number(stat.total_unpaid),
      total_handling_fee: Number(stat.total_handling_fee),
      total_fines: Number(stat.total_fines),
      negotiated_count: stat.negotiated_count,
      blacklist_count: stat.blacklist_count,
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
      // 直接计算统计数据（calculateDailyStatistics会处理重复数据）
      console.log(
        `🔄 计算缺失的统计数据: ${current.toISOString().split('T')[0]}`,
      );
      await this.calculateDailyStatistics(new Date(current));

      current.setDate(current.getDate() + 1);
    }
  }

  // 获取collector/risk_controller的统计数据
  async getCollectorStatistics(adminId: number): Promise<any> {
    // 使用业务日期：从当天的 00:00:00 开始算
    const businessDate = this.getBusinessDate();

    const statistic = await this.prisma.dailyStatistics.findFirst({
      where: {
        admin_id: adminId,
        date: businessDate,
      },
    });

    if (!statistic) {
      // 如果当天数据不存在，返回空数据（使用新字段结构）
      return {
        admin_id: adminId,
        admin_name: '',
        date: businessDate.toISOString().split('T')[0],
        role: 'collector',
        new_in_stock_amount: 0,
        cleared_off_amount: 0,
        total_received: 0,
        total_unpaid: 0,
        total_handling_fee: 0,
        total_fines: 0,
        negotiated_count: 0,
        blacklist_count: 0,
      };
    }

    // 返回新字段结构的数据
    return {
      admin_id: statistic.admin_id,
      admin_name: statistic.admin_name,
      date: statistic.date.toISOString().split('T')[0],
      role: statistic.role,
      new_in_stock_amount: Number(statistic.new_in_stock_amount),
      cleared_off_amount: Number(statistic.cleared_off_amount),
      total_received: Number(statistic.total_received),
      total_unpaid: Number(statistic.total_unpaid),
      total_handling_fee: Number(statistic.total_handling_fee),
      total_fines: Number(statistic.total_fines),
      negotiated_count: statistic.negotiated_count,
      blacklist_count: statistic.blacklist_count,
    };
  }

  // 获取collector/risk_controller的详细统计数据（14行指标）
  async getCollectorDetailedStatistics(
    adminId: number,
    roleType: 'collector' | 'risk_controller',
  ): Promise<any> {
    // 获取该admin相关的所有loan_account_ids
    const roles = await this.prisma.loanAccountRole.findMany({
      where: {
        admin_id: adminId,
        role_type: roleType,
      },
      select: {
        loan_account_id: true,
      },
    });

    const loanAccountIds = roles.map((r) => r.loan_account_id);
    if (loanAccountIds.length === 0) {
      // 如果没有关联的loan accounts，返回空数据
      return this.getEmptyStatistics();
    }

    // 日期计算
    const now = new Date();
    const todayStart = this.getBusinessDayStart();
    const todayEnd = this.getBusinessDayEnd();
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

    return {
      totalAmount,
      totalInStockAmount,
      totalHandlingFee,
      totalFines,
      totalBlacklistCount,
      totalNegotiatedCount,
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
  }

  private getEmptyStatistics() {
    return {
      totalAmount: 0,
      totalInStockAmount: 0,
      totalHandlingFee: 0,
      totalFines: 0,
      totalBlacklistCount: 0,
      totalNegotiatedCount: 0,
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

  async getAdminStatistics(): Promise<any[]> {
    const roles = await this.prisma.loanAccountRole.findMany({
      where: {
        role_type: { in: ['collector', 'risk_controller'] },
      },
      include: {
        admin: true,
        loan_account: true,
      },
    });

    // 按 admin_id + role_type 分组（同一个admin可能同时是collector和risk_controller）
    const adminStats = new Map<string, any>();

    for (const role of roles) {
      const key = `${role.admin_id}_${role.role_type}`;
      if (!adminStats.has(key)) {
        adminStats.set(key, {
          admin_id: role.admin_id,
          admin_name: role.admin.username,
          role: role.role_type, // 使用role_type而不是admin.role
          totalAmount: 0, // 总金额 = Σ(receiving_amount) − Σ(company_cost)
          inStockCount: 0, // 在库人数 = 状态 in [pending, active] 的 LoanAccount 数量
          inStockAmount: 0, // 在库金额 = 状态 in [pending, active] 的 Σ(loan_amount)
          totalReceivingAmount: 0, // 已收金额 = Σ(receiving_amount)（包含罚金）
          totalUnpaidCapital: 0, // 未收本金 = 状态 in [pending, active] 的 Σ(loan_amount − paid_capital)
          totalHandlingFee: 0, // 后扣 = Σ(handling_fee)
          totalFines: 0, // 罚金 = Σ(total_fines)
          negotiatedCount: 0, // 协商 = 状态 negotiated 的数量
          blacklistCount: 0, // 黑名单 = 状态 blacklist 的数量
          loanAccounts: new Set<string>(),
        });
      }
      adminStats.get(key).loanAccounts.add(role.loan_account_id);
    }

    for (const [key, stats] of adminStats.entries()) {
      const loanAccounts = await this.prisma.loanAccount.findMany({
        where: { id: { in: Array.from(stats.loanAccounts) } },
      });

      for (const acc of loanAccounts) {
        // 总金额 = Σ(receiving_amount) − Σ(company_cost)
        stats.totalAmount +=
          Number(acc.receiving_amount || 0) -
          Number(acc.company_cost || 0) +
          Number(acc.handling_fee || 0);

        // 已收金额 = Σ(receiving_amount)（包含罚金）
        stats.totalReceivingAmount += Number(acc.receiving_amount || 0);

        // 后扣 = Σ(handling_fee)
        stats.totalHandlingFee += Number(acc.handling_fee || 0);

        // 罚金 = Σ(total_fines)
        stats.totalFines += Number(acc.total_fines || 0);

        // 在库相关统计：状态 in [pending, active]
        if (acc.status === 'pending' || acc.status === 'active') {
          // 在库人数
          stats.inStockCount++;
          // 在库金额 = 状态 in [pending, active] 的 Σ(loan_amount)
          stats.inStockAmount += Number(acc.loan_amount);
          // 未收本金 = 状态 in [pending, active] 的 Σ(loan_amount − paid_capital)
          stats.totalUnpaidCapital +=
            Number(acc.loan_amount) - Number(acc.paid_capital || 0);
        }

        // 协商 = 状态 negotiated 的数量
        if (acc.status === 'negotiated') {
          stats.negotiatedCount++;
        }

        // 黑名单 = 状态 blacklist 的数量
        if (acc.status === 'blacklist') {
          stats.blacklistCount++;
        }
      }
      delete stats.loanAccounts; // Clean up
    }

    return Array.from(adminStats.values());
  }

  async getTodayAdminStatistics(): Promise<any[]> {
    // 使用业务日期：从当天的 00:00:00 开始，到 23:59:59.999 结束
    const businessDayStart = this.getBusinessDayStart();
    const businessDayEnd = this.getBusinessDayEnd();

    // 获取所有collector和risk_controller角色的loan_account_roles
    const roles = await this.prisma.loanAccountRole.findMany({
      where: {
        role_type: { in: ['collector', 'risk_controller'] },
      },
      include: {
        admin: true,
        loan_account: true,
      },
    });

    // 按 admin_id + role_type 分组
    const adminStats = new Map<string, any>();

    for (const role of roles) {
      const key = `${role.admin_id}_${role.role_type}`;
      if (!adminStats.has(key)) {
        adminStats.set(key, {
          admin_id: role.admin_id,
          admin_name: role.admin.username,
          role: role.role_type,
          newInStockAmount: 0, // 新增在库：当天创建的loanAccounts的loan_amount总和
          clearedOffAmount: 0, // 离库结清：当天RepaymentRecord对应的loanAccount.status=settled的loan_amount总和
          totalReceived: 0, // 已收：当天RepaymentRecord的paid_capital + paid_interest + paid_fines总和
          totalUnpaid: 0, // 未收：当天RepaymentSchedule的(due_amount - paid_capital - paid_interest)总和
          totalHandlingFee: 0, // 后扣：当天新建的loanAccount的handling_fee总和
          totalFines: 0, // 罚金：当天RepaymentRecord的paid_fines总和
          negotiatedCount: 0, // 协商：当天status_changed_at不为空且status=negotiated的数量
          blacklistCount: 0, // 黑名单：当天status_changed_at不为空且status=blacklist的数量
          loanAccounts: new Set<string>(),
        });
      }
      adminStats.get(key).loanAccounts.add(role.loan_account_id);
    }

    for (const [key, stats] of adminStats.entries()) {
      const loanAccountIds: string[] = Array.from(
        stats.loanAccounts as Set<string>,
      );

      // 1. 新增在库：当天创建的loanAccounts的loan_amount总和
      const newLoanAccounts = await this.prisma.loanAccount.findMany({
        where: {
          id: { in: loanAccountIds },
          due_start_date: {
            gte: businessDayStart,
            lt: businessDayEnd,
          },
        },
        select: {
          loan_amount: true,
          handling_fee: true,
        },
      });
      stats.newInStockAmount = newLoanAccounts.reduce(
        (sum, acc) => sum + Number(acc.loan_amount),
        0,
      );
      stats.totalHandlingFee = newLoanAccounts.reduce(
        (sum, acc) => sum + Number(acc.handling_fee),
        0,
      );

      // 2. 离库结清：当天RepaymentRecord对应的loanAccount.status=settled的loan_amount总和
      // 先找到当天创建的RepaymentRecord，然后检查对应的LoanAccount是否在当天变为settled
      const todayRepaymentRecords = await this.prisma.repaymentRecord.findMany({
        where: {
          loan_id: { in: loanAccountIds },
          paid_at: {
            gte: businessDayStart,
            lt: businessDayEnd,
          },
        },
        select: {
          loan_id: true,
        },
        distinct: ['loan_id'],
      });

      const todayRepaymentLoanIds = todayRepaymentRecords.map((r) => r.loan_id);
      if (todayRepaymentLoanIds.length > 0) {
        const settledLoans = await this.prisma.loanAccount.findMany({
          where: {
            id: { in: todayRepaymentLoanIds },
            status: 'settled',
            // 检查是否在当天变为settled（通过updated_at判断，因为settled状态会在updateStatus中更新）
            updated_at: {
              gte: businessDayStart,
              lt: businessDayEnd,
            },
          },
          select: {
            loan_amount: true,
          },
        });
        stats.clearedOffAmount = settledLoans.reduce(
          (sum, acc) => sum + Number(acc.loan_amount),
          0,
        );
      }

      // 3. 已收：当天RepaymentRecord的paid_capital + paid_interest + paid_fines总和
      const todayReceivedRecords = await this.prisma.repaymentRecord.findMany({
        where: {
          loan_id: { in: loanAccountIds },
          paid_at: {
            gte: businessDayStart,
            lt: businessDayEnd,
          },
        },
        select: {
          paid_capital: true,
          paid_interest: true,
          paid_fines: true,
        },
      });
      stats.totalReceived = todayReceivedRecords.reduce(
        (sum, record) =>
          sum +
          Number(record.paid_capital || 0) +
          Number(record.paid_interest || 0) +
          Number(record.paid_fines || 0),
        0,
      );

      // 4. 罚金：当天RepaymentRecord的paid_fines总和
      stats.totalFines = todayReceivedRecords.reduce(
        (sum, record) => sum + Number(record.paid_fines || 0),
        0,
      );

      // 5. 未收：当天RepaymentSchedule的(due_amount - paid_capital - paid_interest)总和
      const pendingLoanAccounts = await this.prisma.loanAccount.findMany({
        where: {
          id: { in: loanAccountIds },
          status: 'pending',
        },
        select: {
          id: true,
        },
      });
      const pendingLoanAccountIds = pendingLoanAccounts.map((l) => l.id);
      // 查询当天 due_start_date 是当天的 RepaymentSchedule
      const todaySchedules = await this.prisma.repaymentSchedule.findMany({
        where: {
          loan_id: { in: pendingLoanAccountIds },
          due_start_date: {
            gte: businessDayStart,
            lt: businessDayEnd,
          },
        },
        select: {
          due_amount: true,
          paid_capital: true,
          paid_interest: true,
        },
      });
      stats.totalUnpaid = todaySchedules.reduce(
        (sum, schedule) =>
          sum +
          (Number(schedule.due_amount || 0) -
            Number(schedule.paid_capital || 0) -
            Number(schedule.paid_interest || 0)),
        0,
      );

      // 6. 协商：当天status_changed_at不为空且status=negotiated的数量
      const negotiatedLoans = await this.prisma.loanAccount.findMany({
        where: {
          id: { in: loanAccountIds },
          status: 'negotiated',
          status_changed_at: {
            gte: businessDayStart,
            lt: businessDayEnd,
          },
        },
      });
      stats.negotiatedCount = negotiatedLoans.length;

      // 7. 黑名单：当天status_changed_at不为空且status=blacklist的数量
      const blacklistLoans = await this.prisma.loanAccount.findMany({
        where: {
          id: { in: loanAccountIds },
          status: 'blacklist',
          status_changed_at: {
            gte: businessDayStart,
            lt: businessDayEnd,
          },
        },
      });
      stats.blacklistCount = blacklistLoans.length;

      delete stats.loanAccounts; // Clean up
    }

    const result = Array.from(adminStats.values());

    // 将统计数据写入数据库
    const businessDate = new Date(businessDayStart);
    businessDate.setHours(0, 0, 0, 0);

    // 将统计数据写入数据库（使用upsert模式处理并发问题）
    try {
      for (const stat of result) {
        try {
          // 先尝试创建，如果记录已存在则更新
          await this.prisma.dailyStatistics.create({
            data: {
              admin_id: stat.admin_id,
              admin_name: stat.admin_name,
              date: businessDate,
              role: stat.role,
              new_in_stock_amount: stat.newInStockAmount,
              cleared_off_amount: stat.clearedOffAmount,
              total_received: stat.totalReceived,
              total_unpaid: stat.totalUnpaid,
              total_handling_fee: stat.totalHandlingFee,
              total_fines: stat.totalFines,
              negotiated_count: stat.negotiatedCount,
              blacklist_count: stat.blacklistCount,
            },
          });
        } catch (createError: any) {
          // 如果是唯一约束冲突（P2002），说明记录已存在，则更新
          if (createError?.code === 'P2002') {
            // 查找现有记录并更新
            const existing = await this.prisma.dailyStatistics.findFirst({
              where: {
                admin_id: stat.admin_id,
                date: businessDate,
                role: stat.role,
              },
            });

            if (existing) {
              await this.prisma.dailyStatistics.update({
                where: { id: existing.id },
                data: {
                  admin_name: stat.admin_name,
                  new_in_stock_amount: stat.newInStockAmount,
                  cleared_off_amount: stat.clearedOffAmount,
                  total_received: stat.totalReceived,
                  total_unpaid: stat.totalUnpaid,
                  total_handling_fee: stat.totalHandlingFee,
                  total_fines: stat.totalFines,
                  negotiated_count: stat.negotiatedCount,
                  blacklist_count: stat.blacklistCount,
                },
              });
            }
          } else {
            // 其他错误重新抛出
            throw createError;
          }
        }
      }
    } catch (error) {
      console.error('保存统计数据到数据库失败:', error);
      // 继续返回结果，即使保存失败
    }

    return result;
  }

  // 获取昨日管理员统计数据
  async getYesterdayAdminStatistics(): Promise<any[]> {
    // 获取昨天的业务日期
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStart = this.getBusinessDayStart(yesterday);
    const yesterdayEnd = this.getBusinessDayEnd(yesterday);

    // 先尝试从数据库读取
    const yesterdayDate = new Date(yesterdayStart);
    yesterdayDate.setHours(0, 0, 0, 0);

    const dbStats = await this.prisma.dailyStatistics.findMany({
      where: {
        date: yesterdayDate,
      },
    });

    // 如果数据库中有数据，直接返回
    if (dbStats.length > 0) {
      return dbStats.map((stat) => ({
        admin_id: stat.admin_id,
        admin_name: stat.admin_name,
        role: stat.role,
        newInStockAmount: Number(stat.new_in_stock_amount),
        clearedOffAmount: Number(stat.cleared_off_amount),
        totalReceived: Number(stat.total_received),
        totalUnpaid: Number(stat.total_unpaid),
        totalHandlingFee: Number(stat.total_handling_fee),
        totalFines: Number(stat.total_fines),
        negotiatedCount: stat.negotiated_count,
        blacklistCount: stat.blacklist_count,
      }));
    }

    // 如果数据库中没有数据，重新计算（复用getTodayAdminStatistics的逻辑，但使用昨天的日期）
    const roles = await this.prisma.loanAccountRole.findMany({
      where: {
        role_type: { in: ['collector', 'risk_controller'] },
      },
      include: {
        admin: true,
        loan_account: true,
      },
    });

    const adminStats = new Map<string, any>();

    for (const role of roles) {
      const key = `${role.admin_id}_${role.role_type}`;
      if (!adminStats.has(key)) {
        adminStats.set(key, {
          admin_id: role.admin_id,
          admin_name: role.admin.username,
          role: role.role_type,
          newInStockAmount: 0,
          clearedOffAmount: 0,
          totalReceived: 0,
          totalUnpaid: 0,
          totalHandlingFee: 0,
          totalFines: 0,
          negotiatedCount: 0,
          blacklistCount: 0,
          loanAccounts: new Set<string>(),
        });
      }
      adminStats.get(key).loanAccounts.add(role.loan_account_id);
    }

    for (const [key, stats] of adminStats.entries()) {
      const loanAccountIds: string[] = Array.from(
        stats.loanAccounts as Set<string>,
      );

      // 1. 新增在库
      const newLoanAccounts = await this.prisma.loanAccount.findMany({
        where: {
          id: { in: loanAccountIds },
          due_start_date: {
            gte: yesterdayStart,
            lt: yesterdayEnd,
          },
        },
        select: {
          loan_amount: true,
          handling_fee: true,
        },
      });
      stats.newInStockAmount = newLoanAccounts.reduce(
        (sum, acc) => sum + Number(acc.loan_amount),
        0,
      );
      stats.totalHandlingFee = newLoanAccounts.reduce(
        (sum, acc) => sum + Number(acc.handling_fee),
        0,
      );

      // 2. 离库结清
      const yesterdayRepaymentRecords =
        await this.prisma.repaymentRecord.findMany({
          where: {
            loan_id: { in: loanAccountIds },
            paid_at: {
              gte: yesterdayStart,
              lt: yesterdayEnd,
            },
          },
          select: {
            loan_id: true,
          },
          distinct: ['loan_id'],
        });

      const yesterdayRepaymentLoanIds = yesterdayRepaymentRecords.map(
        (r) => r.loan_id,
      );
      if (yesterdayRepaymentLoanIds.length > 0) {
        const settledLoans = await this.prisma.loanAccount.findMany({
          where: {
            id: { in: yesterdayRepaymentLoanIds },
            status: 'settled',
            updated_at: {
              gte: yesterdayStart,
              lt: yesterdayEnd,
            },
          },
          select: {
            loan_amount: true,
          },
        });
        stats.clearedOffAmount = settledLoans.reduce(
          (sum, acc) => sum + Number(acc.loan_amount),
          0,
        );
      }

      // 3. 已收
      const yesterdayReceivedRecords =
        await this.prisma.repaymentRecord.findMany({
          where: {
            loan_id: { in: loanAccountIds },
            paid_at: {
              gte: yesterdayStart,
              lt: yesterdayEnd,
            },
          },
          select: {
            paid_capital: true,
            paid_interest: true,
            paid_fines: true,
          },
        });
      stats.totalReceived = yesterdayReceivedRecords.reduce(
        (sum, record) =>
          sum +
          Number(record.paid_capital || 0) +
          Number(record.paid_interest || 0) +
          Number(record.paid_fines || 0),
        0,
      );

      // 4. 罚金
      stats.totalFines = yesterdayReceivedRecords.reduce(
        (sum, record) => sum + Number(record.paid_fines || 0),
        0,
      );

      // 5. 未收
      const pendingLoanAccounts = await this.prisma.loanAccount.findMany({
        where: {
          id: { in: loanAccountIds },
          status: 'pending',
        },
        select: {
          id: true,
        },
      });
      const pendingLoanAccountIds = pendingLoanAccounts.map((l) => l.id);
      const yesterdaySchedules = await this.prisma.repaymentSchedule.findMany({
        where: {
          loan_id: { in: pendingLoanAccountIds },
          due_start_date: {
            gte: yesterdayStart,
            lt: yesterdayEnd,
          },
        },
        select: {
          due_amount: true,
          paid_capital: true,
          paid_interest: true,
        },
      });
      stats.totalUnpaid = yesterdaySchedules.reduce(
        (sum, schedule) =>
          sum +
          (Number(schedule.due_amount || 0) -
            Number(schedule.paid_capital || 0) -
            Number(schedule.paid_interest || 0)),
        0,
      );

      // 6. 协商
      const negotiatedLoans = await this.prisma.loanAccount.findMany({
        where: {
          id: { in: loanAccountIds },
          status: 'negotiated',
          status_changed_at: {
            gte: yesterdayStart,
            lt: yesterdayEnd,
          },
        },
      });
      stats.negotiatedCount = negotiatedLoans.length;

      // 7. 黑名单
      const blacklistLoans = await this.prisma.loanAccount.findMany({
        where: {
          id: { in: loanAccountIds },
          status: 'blacklist',
          status_changed_at: {
            gte: yesterdayStart,
            lt: yesterdayEnd,
          },
        },
      });
      stats.blacklistCount = blacklistLoans.length;

      delete stats.loanAccounts;
    }

    return Array.from(adminStats.values());
  }

  // 检查指定admin_id在指定日期是否有统计数据
  async checkStatisticsExists(adminId: number, date: Date): Promise<boolean> {
    // 使用日期字符串查询，避免时区问题
    const dateStr = date.toISOString().split('T')[0];

    const existing = await this.prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM daily_statistics
      WHERE admin_id = ${adminId}
      AND DATE(date) = ${dateStr}
      LIMIT 1
    `;

    return existing && existing.length > 0;
  }

  // 检查指定日期是否有任何统计数据
  async checkTodayStatisticsExists(date: Date): Promise<boolean> {
    // 使用业务日期：从当天的 00:00:00 开始算
    const businessDate = this.getBusinessDate(date);
    const dateStr = businessDate.toISOString().split('T')[0];

    // 使用原始SQL查询，避免时区问题
    const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM daily_statistics
      WHERE DATE(date) = ${dateStr}
    `;

    return result && result.length > 0 && Number(result[0].count) > 0;
  }

  async getCollectorReport(
    adminId: number,
    roleType: 'collector' | 'risk_controller' = 'collector',
  ) {
    console.log(
      `📊 获取${roleType === 'collector' ? '收款人' : '风控人'}报表: adminId=${adminId}, roleType=${roleType}`,
    );

    // 1. 获取当前角色关联的loanAccount IDs
    const collectorLoanRoles = await this.prisma.loanAccountRole.findMany({
      where: {
        admin_id: adminId,
        role_type: roleType,
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
        risk_controller: {
          select: {
            id: true,
            username: true,
          },
        },
        collector: {
          select: {
            id: true,
            username: true,
          },
        },
      },
      orderBy: {
        risk_controller_id: 'asc',
      },
    });

    // 3. 根据角色类型决定分组方式：collector按risk_controller分组，risk_controller按collector分组
    const groupedByRole = new Map<number, any[]>();
    const groupTotals = new Map<number, number>();
    const roleNames = new Map<number, string>();

    loanAccounts.forEach((account) => {
      // 如果是collector角色，按risk_controller分组；如果是risk_controller角色，按collector分组
      const groupId =
        roleType === 'collector'
          ? account.risk_controller_id
          : account.collector_id;
      const groupName =
        roleType === 'collector'
          ? account.risk_controller?.username || ''
          : account.collector?.username || '';

      if (!groupedByRole.has(groupId)) {
        groupedByRole.set(groupId, []);
        groupTotals.set(groupId, 0);
        roleNames.set(groupId, groupName);
      }

      groupedByRole.get(groupId)!.push({
        id: account.id,
        user_id: account.user_id,
        user_name: account.user.username,
        user_phone: account.user.phone,
        user_address: account.user.address,
        loan_amount: Number(account.loan_amount),
        receiving_amount: Number(account.receiving_amount || 0),
        capital: Number(account.capital),
        paid_capital: Number(account.paid_capital),
        interest: Number(account.interest),
        status: account.status,
        total_periods: account.total_periods,
        repaid_periods: account.repaid_periods,
        due_start_date: account.due_start_date,
        due_end_date: account.due_end_date,
        created_at: account.created_at,
      });

      const currentTotal = groupTotals.get(groupId)!;
      groupTotals.set(
        groupId,
        currentTotal + Number(account.receiving_amount || 0),
      );
    });

    // 4. 格式化分组数据
    const groupedData = Array.from(groupedByRole.entries()).map(
      ([groupId, accounts]) => ({
        [roleType === 'collector' ? 'risk_controller_id' : 'collector_id']:
          groupId,
        [roleType === 'collector' ? 'risk_controller' : 'collector']:
          roleNames.get(groupId) || '',
        total_receiving_amount: groupTotals.get(groupId) || 0,
        loan_count: accounts.length,
        accounts: accounts,
      }),
    );

    // 5. 计算总览统计数据（使用现有的统计方法获取Stats类型数据）
    const now = new Date();
    // 使用业务日期：从当天的 00:00:00 开始，到 23:59:59.999 结束
    const businessDayStart = this.getBusinessDayStart(now);
    const businessDayEnd = this.getBusinessDayEnd(now);

    // 本月开始（从业务日期的月份1号开始）
    const businessDate = this.getBusinessDate(now);
    const startOfMonth = new Date(
      businessDate.getFullYear(),
      businessDate.getMonth(),
      1,
    );
    startOfMonth.setHours(6, 0, 0, 0);

    // 本年开始（从业务日期的年份1月1号开始）
    const startOfYear = new Date(businessDate.getFullYear(), 0, 1);
    startOfYear.setHours(6, 0, 0, 0);

    // 今日收款（业务日期的 00:00:00 到 23:59:59.999）- 从repayment_schedules统计
    const todayPaidSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: { in: loanAccountIds },
        paid_at: { gte: businessDayStart, lt: businessDayEnd },
      },
      select: {
        paid_amount: true,
      },
    });
    const todayCollection = {
      _sum: {
        paid_amount: todayPaidSchedules.reduce(
          (sum, s) => sum + Number(s.paid_amount || 0),
          0,
        ),
      },
    };

    // 本月收款（从本月1号 00:00:00 开始到现在）- 从repayment_schedules统计
    const monthSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: { in: loanAccountIds },
        paid_at: { gte: startOfMonth },
      },
      select: {
        paid_amount: true,
      },
    });
    const monthCollection = {
      _sum: {
        paid_amount: monthSchedules.reduce(
          (sum, s) => sum + Number(s.paid_amount || 0),
          0,
        ),
      },
    };

    // 本年收款（从本年1月1号 00:00:00 开始到现在）- 从repayment_schedules统计
    const yearSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: { in: loanAccountIds },
        paid_at: { gte: startOfYear },
      },
      select: {
        paid_amount: true,
      },
    });
    const yearCollection = {
      _sum: {
        paid_amount: yearSchedules.reduce(
          (sum, s) => sum + Number(s.paid_amount || 0),
          0,
        ),
      },
    };

    // 总手续费
    const totalHandlingFee = loanAccounts.reduce(
      (sum, account) => sum + Number(account.handling_fee),
      0,
    );

    // 今日事项统计（业务日期的 00:00:00 到 23:59:59.999）
    // 使用 due_start_date 来查询今天应该还款的计划
    const todayDueSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: { in: loanAccountIds },
        due_start_date: {
          gte: businessDayStart,
          lt: businessDayEnd,
        },
      },
      select: {
        status: true,
      },
    });

    // 今日已付款数量
    const todayPaidCount = todayDueSchedules.filter(
      (s) => s.status === 'paid',
    ).length;
    // 今日待处理数量（pending 或 active）
    const todayPendingCount = todayDueSchedules.filter(
      (s) => s.status === 'pending' || s.status === 'active',
    ).length;

    // 逾期统计：查询所有 due_end_date 超过当前时间且未完全支付的记录
    // 注意：这里使用前面定义的 now 变量
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const overdueSchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: { in: loanAccountIds },
      },
      select: {
        id: true,
        due_amount: true,
        paid_amount: true,
      },
    });

    // 在内存中过滤出未完全支付的记录（paid_amount < due_amount）
    const todayOverdueCount = overdueSchedules.filter((s) => {
      const dueAmount = Number(s.due_amount || 0);
      const paidAmount = Number(s.paid_amount || 0);
      return paidAmount < dueAmount;
    }).length;

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
        risk_controller_id: account.risk_controller_id,
        risk_controller: account.risk_controller.username,
        total_periods: account.total_periods,
        repaid_periods: account.repaid_periods,
        due_start_date: account.due_start_date,
        due_end_date: account.due_end_date,
        created_at: account.created_at,
      })),
    };
  }
}
