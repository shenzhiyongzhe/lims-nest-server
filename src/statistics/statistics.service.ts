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
          inStockCount: 0, // 在库人数 = 状态 in [pending,negotiated] 的 LoanAccount 数量
          inStockAmount: 0, // 在库金额 = 状态 in [pending,negotiated] 的 Σ(loan_amount)
          totalReceivingAmount: 0, // 已收金额 = Σ(receiving_amount)（包含罚金）
          totalUnpaidCapital: 0, // 未收本金 = 状态 in [pending,negotiated] 的 Σ(loan_amount − paid_capital)
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

        // 在库相关统计：状态 in [pending, negotiated]
        if (acc.status === 'pending' || acc.status === 'negotiated') {
          // 在库人数
          stats.inStockCount++;
          // 在库金额 = 状态 in [pending, negotiated] 的 Σ(loan_amount)
          stats.inStockAmount += Number(acc.loan_amount);
          // 未收本金 = 状态 in [pending, negotiated] 的 Σ(loan_amount − paid_capital)
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
}
