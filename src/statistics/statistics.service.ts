import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取业务日期（每天早上6点以后算当天，6点前算前一天）
   * @param date 基准日期，如果不提供则使用当前时间
   * @returns 业务日期（只包含日期部分，时间设为0点）
   */
  private getBusinessDate(date?: Date): Date {
    const now = date || new Date();
    const businessDate = new Date(now);

    // 如果当前时间在6点之前，则业务日期是前一天
    if (now.getHours() < 6) {
      businessDate.setDate(now.getDate() - 1);
    }

    // 设置时间为0点
    businessDate.setHours(0, 0, 0, 0);
    return businessDate;
  }

  /**
   * 获取业务日期的开始时间（当天6点）
   * @param date 基准日期，如果不提供则使用当前时间
   * @returns 业务日期的开始时间（当天6点）
   */
  private getBusinessDayStart(date?: Date): Date {
    const businessDate = this.getBusinessDate(date);
    businessDate.setHours(6, 0, 0, 0);
    return businessDate;
  }

  /**
   * 获取业务日期的结束时间（次日6点）
   * @param date 基准日期，如果不提供则使用当前时间
   * @returns 业务日期的结束时间（次日6点）
   */
  private getBusinessDayEnd(date?: Date): Date {
    const businessDayStart = this.getBusinessDayStart(date);
    const businessDayEnd = new Date(businessDayStart);
    businessDayEnd.setDate(businessDayEnd.getDate() + 1);
    return businessDayEnd;
  }

  async calculateDailyStatistics(date: Date): Promise<void> {
    // 获取日期字符串（YYYY-MM-DD），避免时区问题
    const dateStr = date.toISOString().split('T')[0];

    // 构造一个UTC时间的Date对象用于保存到数据库（DATE类型）
    // 使用日期字符串 + 中午12点（UTC），这样无论什么时区，日期部分都是正确的
    const dateForDb = new Date(dateStr + 'T12:00:00.000Z');

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

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

    // 2. 按admin_id分组，合并同一人在不同角色下的数据
    const adminStatsMap = new Map<
      number,
      {
        admin_id: number;
        admin_name: string;
        loan_account_ids: Set<string>;
      }
    >();

    for (const role of roles) {
      const adminId = role.admin_id;
      const adminName = role.admin.username;
      const loanAccountId = role.loan_account_id;

      if (!adminStatsMap.has(adminId)) {
        adminStatsMap.set(adminId, {
          admin_id: adminId,
          admin_name: adminName,
          loan_account_ids: new Set(),
        });
      }

      const stats = adminStatsMap.get(adminId)!;
      stats.loan_account_ids.add(loanAccountId);
    }

    // 3. 为每个admin统计相关的数据
    // 使用事务来确保所有操作的原子性
    await this.prisma.$transaction(
      async (tx) => {
        for (const [adminId, stats] of adminStatsMap.entries()) {
          const loanIds = Array.from(stats.loan_account_ids);

          // 计算该admin相关的repayment_records金额（当天实际收款）
          const repaymentResult = await tx.repaymentRecord.aggregate({
            where: {
              loan_id: {
                in: loanIds,
              },
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

          // 计算当天到期的还款计划的应收金额（还未还清的部分）
          // receiving_amount = 当天到期的还款计划中，未还清的部分（due_amount - paid_amount）
          // 使用下一天的开始时间作为上限，确保包含当天的所有数据
          const nextDayStart = new Date(endOfDay);
          nextDayStart.setDate(endOfDay.getDate() + 1);
          nextDayStart.setHours(0, 0, 0, 0);

          const todaySchedules = await tx.repaymentSchedule.findMany({
            where: {
              loan_id: {
                in: loanIds,
              },
              due_start_date: {
                gte: startOfDay,
                lt: nextDayStart, // 小于下一天的开始
              },
            },
            select: {
              due_amount: true,
              paid_amount: true,
            },
          });

          // 计算当天到期的应收金额（未还清的部分）
          let receivingAmount = 0;
          for (const schedule of todaySchedules) {
            const dueAmount = Number(schedule.due_amount || 0);
            const paidAmount = Number(schedule.paid_amount || 0);
            const remaining = dueAmount - paidAmount;
            if (remaining > 0) {
              receivingAmount += remaining;
            }
          }

          const payeeAmount = Number(repaymentResult._sum.paid_amount || 0);
          const transactionCount = repaymentResult._count.id;
          const totalAmount = payeeAmount;

          console.log(`📈 ${stats.admin_name}(${adminId}) 统计结果:`, {
            date: date.toISOString().split('T')[0],
            totalAmount,
            payeeAmount,
            receivingAmount,
            transactionCount,
            todaySchedulesCount: todaySchedules.length,
          });

          // 4. 保存或更新统计数据（按admin_id + date唯一）
          // 使用事务内的 upsert 模式：先尝试创建，如果失败（唯一约束）则更新
          // 这样可以避免并发请求时的竞态条件
          try {
            // 尝试创建新记录，使用统一的日期格式
            await tx.dailyStatistics.create({
              data: {
                admin_id: adminId,
                admin_name: stats.admin_name,
                date: dateForDb,
                total_amount: totalAmount,
                payee_amount: payeeAmount,
                receiving_amount: receivingAmount,
                transaction_count: transactionCount,
              },
            });
            console.log(
              `✅ 创建统计记录: admin_id=${adminId}, date=${dateStr}`,
            );
          } catch (error: any) {
            // 如果是唯一约束错误（P2002），说明记录已存在，则更新
            if (error?.code === 'P2002') {
              // 使用原始SQL查询查找现有记录（避免时区问题）
              const existing = await tx.$queryRaw<Array<{ id: number }>>`
                SELECT id FROM daily_statistics
                WHERE admin_id = ${adminId}
                AND DATE(date) = ${dateStr}
                LIMIT 1
              `;

              if (existing && existing.length > 0) {
                // 更新现有记录
                await tx.dailyStatistics.update({
                  where: {
                    id: existing[0].id,
                  },
                  data: {
                    total_amount: totalAmount,
                    payee_amount: payeeAmount,
                    receiving_amount: receivingAmount,
                    transaction_count: transactionCount,
                    updated_at: new Date(),
                  },
                });
                console.log(
                  `✅ 更新统计记录: admin_id=${adminId}, date=${dateStr}, id=${existing[0].id}`,
                );
              } else {
                // 如果找不到记录，可能是并发问题，记录日志但不抛出错误
                console.warn(
                  `⚠️ 警告：唯一约束冲突但未找到记录 admin_id=${adminId}, date=${dateStr}`,
                );
                // 尝试再次创建（可能其他事务已经提交）
                try {
                  await tx.dailyStatistics.create({
                    data: {
                      admin_id: adminId,
                      admin_name: stats.admin_name,
                      date: dateForDb,
                      total_amount: totalAmount,
                      payee_amount: payeeAmount,
                      receiving_amount: receivingAmount,
                      transaction_count: transactionCount,
                    },
                  });
                  console.log(
                    `✅ 重试创建统计记录成功: admin_id=${adminId}, date=${dateStr}`,
                  );
                } catch (retryError: any) {
                  console.error(
                    `❌ 重试创建失败: admin_id=${adminId}, date=${dateStr}`,
                    retryError,
                  );
                }
              }
            } else {
              // 其他错误直接抛出
              throw error;
            }
          }
        }
      },
      {
        // 设置事务超时时间为30秒
        timeout: 30000,
      },
    );

    console.log(`✅ ${dateStr} 统计数据已保存`);
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

    return statistics.map((stat) => ({
      admin_id: stat.admin_id,
      admin_name: stat.admin_name,
      date: stat.date.toISOString().split('T')[0],
      total_amount: Number(stat.total_amount),
      payee_amount: Number(stat.payee_amount),
      receiving_amount: Number(stat.receiving_amount),
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
      // 直接计算统计数据（calculateDailyStatistics会处理重复数据）
      console.log(
        `🔄 计算缺失的统计数据: ${current.toISOString().split('T')[0]}`,
      );
      await this.calculateDailyStatistics(new Date(current));

      current.setDate(current.getDate() + 1);
    }
  }

  // 获取collector/risk_controller的当天统计数据
  async getCollectorStatistics(adminId: number): Promise<any> {
    // 使用业务日期：6点后算当天，6点前算前一天
    const businessDate = this.getBusinessDate();

    const statistic = await this.prisma.dailyStatistics.findFirst({
      where: {
        admin_id: adminId,
        date: businessDate,
      },
    });

    if (!statistic) {
      // 如果当天数据不存在，返回空数据
      return {
        admin_id: adminId,
        admin_name: '',
        date: businessDate.toISOString().split('T')[0],
        total_amount: 0,
        payee_amount: 0,
        receiving_amount: 0,
        transaction_count: 0,
      };
    }

    return {
      admin_id: statistic.admin_id,
      admin_name: statistic.admin_name,
      date: statistic.date.toISOString().split('T')[0],
      total_amount: Number(statistic.total_amount),
      payee_amount: Number(statistic.payee_amount),
      receiving_amount: Number(statistic.receiving_amount),
      transaction_count: statistic.transaction_count,
    };
  }

  // 获取管理员统计数据：按collector和risk_controller分组统计receiving_amount
  async getAdminStatistics(): Promise<any[]> {
    // 使用业务日期：6点后算当天，6点前算前一天
    const businessDate = this.getBusinessDate();

    // 将日期转换为 YYYY-MM-DD 格式字符串，避免时区问题
    const dateStr = businessDate.toISOString().split('T')[0];

    console.log(`🔍 查询统计数据:`);
    console.log(`  - businessDate: ${businessDate.toISOString()}`);
    console.log(`  - dateStr: ${dateStr}`);

    // 直接使用原始 SQL 查询，使用 DATE() 函数比较，避免时区问题
    console.log(`  - 使用原始 SQL 查询日期: ${dateStr}`);

    // 使用 Prisma 的原始 SQL 查询，使用参数化查询防止 SQL 注入
    const rawStats = await this.prisma.$queryRaw<
      Array<{
        id: number;
        admin_id: number;
        admin_name: string;
        date: Date;
        total_amount: any;
        payee_amount: any;
        receiving_amount: any;
        transaction_count: number;
        admin_id_included: number;
        username: string;
        role: string;
      }>
    >`
      SELECT 
        ds.id,
        ds.admin_id,
        ds.admin_name,
        ds.date,
        ds.total_amount,
        ds.payee_amount,
        ds.receiving_amount,
        ds.transaction_count,
        a.id as admin_id_included,
        a.username,
        a.role
      FROM daily_statistics ds
      INNER JOIN admins a ON ds.admin_id = a.id
      WHERE DATE(ds.date) = ${dateStr}
      ORDER BY ds.receiving_amount DESC
    `;

    console.log(`✅ 原始 SQL 查询结果: rawStats.length=${rawStats.length}`);

    // 将原始 SQL 结果转换为返回格式
    const statistics = rawStats.map((stat) => {
      // 处理日期：确保转换为字符串格式
      let dateValue: string;
      const dateObj = stat.date as Date | string;
      if (dateObj instanceof Date) {
        dateValue = dateObj.toISOString().split('T')[0];
      } else if (typeof dateObj === 'string') {
        dateValue = dateObj.split('T')[0];
      } else {
        dateValue = dateStr;
      }

      return {
        admin_id: stat.admin_id,
        admin_name: stat.admin_name,
        role: stat.role,
        date: dateValue,
        total_amount:
          Number(stat.receiving_amount || 0) + Number(stat.payee_amount || 0),

        payee_amount: Number(stat.payee_amount || 0),
        receiving_amount: Number(stat.receiving_amount || 0),
        transaction_count: Number(stat.transaction_count || 0),
      };
    });

    console.log(
      `✅ 最终查询结果: statistics.length=${statistics.length}; admin_names=${statistics.map((stat) => stat.admin_name).join(', ')}`,
    );

    return statistics;
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
    // 使用业务日期：6点后算当天，6点前算前一天
    const businessDate = this.getBusinessDate(date);
    const dateStr = businessDate.toISOString().split('T')[0];

    // 使用原始SQL查询，避免时区问题
    const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM daily_statistics
      WHERE DATE(date) = ${dateStr}
    `;

    return result && result.length > 0 && Number(result[0].count) > 0;
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
        risk_controller: {
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

    // 3. 按risk_controller分组
    const groupedByRiskController = new Map<number, any[]>();
    const groupTotals = new Map<number, number>();
    const riskControllerNames = new Map<number, string>();

    loanAccounts.forEach((account) => {
      const riskControllerId = account.risk_controller_id;
      const riskControllerName = account.risk_controller.username;

      if (!groupedByRiskController.has(riskControllerId)) {
        groupedByRiskController.set(riskControllerId, []);
        groupTotals.set(riskControllerId, 0);
        riskControllerNames.set(riskControllerId, riskControllerName);
      }

      groupedByRiskController.get(riskControllerId)!.push({
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

      const currentTotal = groupTotals.get(riskControllerId)!;
      groupTotals.set(
        riskControllerId,
        currentTotal + Number(account.receiving_amount || 0),
      );
    });

    // 4. 格式化分组数据
    const groupedData = Array.from(groupedByRiskController.entries()).map(
      ([riskControllerId, accounts]) => ({
        risk_controller_id: riskControllerId,
        risk_controller: riskControllerNames.get(riskControllerId) || '',
        total_receiving_amount: groupTotals.get(riskControllerId) || 0,
        loan_count: accounts.length,
        accounts: accounts,
      }),
    );

    // 5. 计算总览统计数据（使用现有的统计方法获取Stats类型数据）
    const now = new Date();
    // 使用业务日期：6点后算当天，6点前算前一天
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

    // 今日收款（业务日期的6点到次日6点）
    const todayCollection = await this.prisma.repaymentRecord.aggregate({
      where: {
        loan_id: { in: loanAccountIds },
        paid_at: { gte: businessDayStart, lt: businessDayEnd },
      },
      _sum: { paid_amount: true },
    });

    // 本月收款（从本月1号6点开始到现在）
    const monthCollection = await this.prisma.repaymentRecord.aggregate({
      where: {
        loan_id: { in: loanAccountIds },
        paid_at: { gte: startOfMonth },
      },
      _sum: { paid_amount: true },
    });

    // 本年收款（从本年1月1号6点开始到现在）
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

    // 今日事项统计（业务日期的6点到次日6点）
    // 使用 due_start_date 来查询今天应该还款的计划
    const todaySchedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: { in: loanAccountIds },
        due_start_date: {
          gte: businessDayStart,
          lt: businessDayEnd,
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
