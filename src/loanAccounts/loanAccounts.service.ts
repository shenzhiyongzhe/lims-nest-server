import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LoanAccount,
  LoanAccountStatus,
  RepaymentScheduleStatus,
  OrderStatus,
  PaymentMethod,
  User,
  ManagementRoles,
} from '@prisma/client';
import { CreateLoanAccountDto } from './dto/create-loanAccount.dto';
import { UpdateLoanAccountDto } from './dto/update-loanAccount.dto';
import {
  AdminReportDetailRow,
  AdminReportSummaryEntry,
  ExcelExportService,
} from '../common/excel-export.service';
import { LoanPredictionService } from '../loan-prediction/loan-prediction.service';
import { AssetManagementService } from '../asset-management/asset-management.service';
@Injectable()
export class LoanAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excelExportService: ExcelExportService,
    private readonly loanPredictionService: LoanPredictionService,
    private readonly assetManagementService: AssetManagementService,
  ) {}

  /**
   * 获取归属人列表（根据当前用户角色）
   * - 管理员：返回所有负责人和风控人
   * - 负责人：返回与他同一 loanAccounts 下的风控人
   * - 风控人：返回与他关联的负责人
   */
  async getRelatedAdmins(
    adminId: number,
    userRole: string,
  ): Promise<Array<{ id: number; username: string; role: string }>> {
    // 管理员：返回所有负责人和风控人
    if (userRole === 'ADMIN') {
      const admins = await this.prisma.admin.findMany({
        where: {
          role: {
            in: ['COLLECTOR', 'RISK_CONTROLLER'],
          },
        },
        select: {
          id: true,
          username: true,
          role: true,
        },
        orderBy: {
          username: 'asc',
        },
      });
      return admins.map((admin) => ({
        id: admin.id,
        username: admin.username,
        role: admin.role,
      }));
    }

    // 负责人：获取与他同一 loanAccounts 下的风控人
    if (userRole === 'COLLECTOR') {
      // 1. 获取该负责人关联的所有 loan_account_id
      const collectorRoles = await this.prisma.loanAccountRole.findMany({
        where: {
          admin_id: adminId,
          role_type: 'collector',
        },
        select: {
          loan_account_id: true,
        },
        distinct: ['loan_account_id'],
      });

      const loanAccountIds = collectorRoles.map((role) => role.loan_account_id);

      if (loanAccountIds.length === 0) {
        return [];
      }

      // 2. 获取这些 loan_account_id 对应的所有风控人
      const riskControllerRoles = await this.prisma.loanAccountRole.findMany({
        where: {
          loan_account_id: {
            in: loanAccountIds,
          },
          role_type: 'risk_controller',
        },
        select: {
          admin_id: true,
        },
        distinct: ['admin_id'],
      });

      const riskControllerIds = riskControllerRoles.map(
        (role) => role.admin_id,
      );

      if (riskControllerIds.length === 0) {
        return [];
      }

      // 3. 获取这些风控人的详细信息
      const admins = await this.prisma.admin.findMany({
        where: {
          id: {
            in: riskControllerIds,
          },
          role: 'RISK_CONTROLLER',
        },
        select: {
          id: true,
          username: true,
          role: true,
        },
        orderBy: {
          username: 'asc',
        },
      });

      return admins.map((admin) => ({
        id: admin.id,
        username: admin.username,
        role: admin.role,
      }));
    }

    // 风控人：获取与他关联的负责人
    if (userRole === 'RISK_CONTROLLER') {
      // 1. 获取该风控人关联的所有 loan_account_id
      const riskControllerRoles = await this.prisma.loanAccountRole.findMany({
        where: {
          admin_id: adminId,
          role_type: 'risk_controller',
        },
        select: {
          loan_account_id: true,
        },
        distinct: ['loan_account_id'],
      });

      const loanAccountIds = riskControllerRoles.map(
        (role) => role.loan_account_id,
      );

      if (loanAccountIds.length === 0) {
        return [];
      }

      // 2. 获取这些 loan_account_id 对应的所有负责人
      const collectorRoles = await this.prisma.loanAccountRole.findMany({
        where: {
          loan_account_id: {
            in: loanAccountIds,
          },
          role_type: 'collector',
        },
        select: {
          admin_id: true,
        },
        distinct: ['admin_id'],
      });

      const collectorIds = collectorRoles.map((role) => role.admin_id);

      if (collectorIds.length === 0) {
        return [];
      }

      // 3. 获取这些负责人的详细信息
      const admins = await this.prisma.admin.findMany({
        where: {
          id: {
            in: collectorIds,
          },
          role: 'COLLECTOR',
        },
        select: {
          id: true,
          username: true,
          role: true,
        },
        orderBy: {
          username: 'asc',
        },
      });

      return admins.map((admin) => ({
        id: admin.id,
        username: admin.username,
        role: admin.role,
      }));
    }

    return [];
  }

  /**
   * 判断日期是否已过期（UTC 时间）
   * @param date 要判断的日期
   * @returns 是否已过期
   */
  private isOverdue(date: Date): boolean {
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

    const dateUTC = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );

    return dateUTC < todayStart;
  }

  /**
   * 根据日期判断还款计划的状态
   * @param startDate 开始日期
   * @param endDate 结束日期
   * @param currentStatus 当前状态
   * @returns 应该的状态
   */
  private determineScheduleStatus(
    endDate: Date,
    currentStatus: RepaymentScheduleStatus,
  ): RepaymentScheduleStatus {
    // 如果已经是 paid 状态，保持不变
    if (currentStatus === 'paid') {
      return 'paid';
    }

    // 如果已过期，返回 overdue
    if (this.isOverdue(endDate)) {
      return 'overdue';
    }

    // 否则返回 pending
    return 'pending';
  }

  findAll(): Promise<LoanAccount[]> {
    return this.prisma.loanAccount.findMany({ include: { user: true } });
  }

  async create(
    data: CreateLoanAccountDto,
    createdBy: number,
  ): Promise<LoanAccount> {
    const {
      due_start_date,
      total_periods,
      daily_repayment,
      capital,
      interest,
    } = data;

    // 设置时间
    // 解析日期字符串（YYYY-MM-DD 格式）
    // 使用 UTC 时间创建日期，避免时区转换导致的日期偏移
    const parseDate = (dateStr: string): Date => {
      const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        const [, year, month, day] = match;
        // 使用 UTC 时间创建日期，确保日期部分不会因时区转换而改变
        return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      }
      // 如果格式不匹配，尝试直接解析
      const date = new Date(dateStr);
      // 如果解析成功，转换为 UTC 时间的午夜
      if (!isNaN(date.getTime())) {
        return new Date(
          Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
          ),
        );
      }
      return date;
    };

    const startDate = parseDate(due_start_date);
    const endDate = parseDate(data.due_end_date);

    // 使用事务：创建贷款记录并批量创建还款计划
    const loan = await this.prisma.$transaction(async (tx) => {
      const existingCount = await tx.loanAccount.count({
        where: { user_id: data.user_id },
      });

      const applyTimes = existingCount;

      const created = await tx.loanAccount.create({
        data: {
          user_id: data.user_id,
          loan_amount: data.loan_amount,
          receiving_amount: data.receiving_amount,
          risk_controller_id: data.risk_controller_id,
          collector_id: data.collector_id,
          lender_id: data.lender_id,
          company_cost: data.company_cost,
          handling_fee: data.handling_fee as number,
          to_hand_ratio: data.to_hand_ratio,
          due_start_date: startDate,
          due_end_date: endDate,
          total_periods: Number(total_periods),
          daily_repayment: Number(daily_repayment),
          apply_times: applyTimes,
          capital: Number(capital),
          interest: Number(interest),
          status: data.status as LoanAccountStatus,
          repaid_periods: 0,
          created_by: createdBy,
          note: data.remark || '',
          ownership: data.ownership || null,
        },
      });

      const periods = Number(total_periods) || 0;
      const perCapital = Number(capital) || 0; // 每期本金（除最后一期）
      const perInterest = Number(interest) || 0; // 每期利息（固定不变）
      // 生成还款计划：最后一期本金为剩余本金；应还金额 = 本金 + 利息
      let remainingPrincipal = Number(data.loan_amount) || 0; // 假定 loan_amount 为总本金
      const rows = Array.from({ length: periods }).map((_, idx) => {
        // 计算每期的开始日期：第一期使用 due_start_date，后续每期依次往后延
        // 使用 UTC 时间计算，避免时区转换问题
        // 周期是一天，所以每期的due_start_date就是开始日期
        const baseDate = new Date(created.due_start_date);
        const d = new Date(
          Date.UTC(
            baseDate.getUTCFullYear(),
            baseDate.getUTCMonth(),
            baseDate.getUTCDate() + idx,
          ),
        );

        // 计算本期本金：前 n-1 期使用固定每期本金，最后一期取剩余本金
        let curCapital = 0;
        if (idx < periods - 1) {
          curCapital = Math.min(perCapital, Math.max(0, remainingPrincipal));
        } else {
          curCapital = Math.max(0, remainingPrincipal);
        }
        curCapital = Number(curCapital.toFixed(2));

        const curInterest = Number(perInterest.toFixed(2));
        const dueAmount = Number((curCapital + curInterest).toFixed(2));

        remainingPrincipal = Number(
          Math.max(0, remainingPrincipal - curCapital).toFixed(2),
        );

        let scheduleStatus: RepaymentScheduleStatus = 'pending';
        scheduleStatus = this.determineScheduleStatus(d, 'pending');

        return {
          loan_id: created.id,
          period: idx + 1,
          due_start_date: d,
          due_amount: dueAmount,
          capital: curCapital,
          interest: perInterest || null,
          paid_capital: 0,
          paid_interest: 0,
          status: scheduleStatus,
        };
      });

      if (rows.length > 0) {
        await tx.repaymentSchedule.createMany({ data: rows });
      }
      const overdueSchedules = await tx.repaymentSchedule.findMany({
        where: {
          loan_id: created.id,
          status: 'overdue',
        },
      });
      await tx.loanAccount.update({
        where: { id: created.id },
        data: { overdue_count: overdueSchedules.length },
      });
      // 直接使用传入的admin_id创建LoanAccountRole
      await tx.loanAccountRole.createMany({
        data: [
          {
            loan_account_id: created.id,
            admin_id: data.collector_id,
            role_type: 'collector',
          },
          {
            loan_account_id: created.id,
            admin_id: data.risk_controller_id,
            role_type: 'risk_controller',
          },
          {
            loan_account_id: created.id,
            admin_id: data.lender_id,
            role_type: 'lender',
          },
        ],
        skipDuplicates: true,
      });
      return created;
    });

    // 更新预测数据
    try {
      await this.loanPredictionService.updatePredictions(loan);
    } catch (error) {
      // 预测更新失败不影响主流程，只记录错误
      console.error('更新预测数据失败:', error);
    }

    // 更新 collector 和 risk_controller 资产数据
    try {
      await this.assetManagementService.updateCollectorAssetFromLoanAccount(
        data.collector_id,
        loan,
      );
      await this.assetManagementService.updateRiskControllerAssetFromLoanAccount(
        data.risk_controller_id,
        loan,
      );
    } catch (error) {
      console.error('更新资产数据失败:', error);
    }

    return loan;
  }

  async findById(id: string): Promise<any> {
    const loan = await this.prisma.loanAccount.findUnique({
      where: { id },
      include: {
        user: true,
        repaymentSchedules: {
          orderBy: {
            period: 'asc',
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
        lender: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    if (!loan) {
      return null;
    }

    // 计算统计数据
    const schedules = loan.repaymentSchedules || [];

    const sumNumber = (value?: any) =>
      value !== null && value !== undefined ? Number(value) : 0;

    // 如果状态是 settled 或 blacklist，直接使用 LoanAccount 的字段值
    if (loan.status === 'settled' || loan.status === 'blacklist') {
      const receivingAmount = Number(loan.receiving_amount || 0);
      const paidCapital = Number(loan.paid_capital || 0);
      const paidInterest = Number(loan.paid_interest || 0);
      const totalFines = Number(loan.total_fines || 0);

      return {
        ...loan,
        statistics: {
          receivingAmount, // 已收金额 = loanAccount.receiving_amount
          paidCapital, // 已还本金 = loanAccount.paid_capital
          paidInterest, // 已还利息 = loanAccount.paid_interest
          totalFines, // 罚金 = loanAccount.total_fines
          unpaidCapital: 0, // 未还本金 = 0
          remainingCapital: 0, // 还需还款本金 = 0
          remainingInterest: 0, // 还需还款利息 = 0
        },
      };
    }

    // 对于其他状态，从还款计划中计算统计数据
    const totalCapital = schedules.reduce(
      (sum, schedule) => sum + sumNumber(schedule.capital),
      0,
    );
    const totalInterest = schedules.reduce(
      (sum, schedule) => sum + sumNumber(schedule.interest),
      0,
    );

    // 已还本金/利息
    const paidCapital = schedules.reduce(
      (sum, schedule) => sum + sumNumber(schedule.paid_capital),
      0,
    );
    const paidInterest = schedules.reduce(
      (sum, schedule) => sum + sumNumber(schedule.paid_interest),
      0,
    );

    // 剩余（待还）本金/利息
    const remainingCapital = Math.max(totalCapital - paidCapital, 0);
    const remainingInterest = Math.max(totalInterest - paidInterest, 0);

    const totalFines = schedules.reduce(
      (sum, schedule) => sum + sumNumber(schedule.fines),
      0,
    );

    const unpaidCapital = remainingCapital;

    // 已收金额 = 所有期的已还本金+已还利息+罚金
    const receivingAmount = schedules.reduce(
      (sum, schedule) =>
        sum +
        sumNumber(schedule.paid_capital) +
        sumNumber(schedule.paid_interest) +
        sumNumber(schedule.fines),
      0,
    );

    // 将统计数据添加到返回对象
    return {
      ...loan,
      statistics: {
        receivingAmount, // 已收金额
        paidCapital, // 已还本金
        paidInterest, // 已还利息
        totalFines, // 罚金
        unpaidCapital, // 未还本金
        remainingCapital, // 还需还款本金
        remainingInterest, // 还需还款利息
      },
    };
  }

  /**
   * 获取空结果
   */
  private getEmptyResult() {
    return {
      statistics: {
        inStock: 0,
        handlingFee: 0,
        fines: 0,
        remainingDebt: 0,
      },
      data: [],
      total: 0,
      relatedAdmins: [],
    };
  }

  /**
   * 获取管理员权限相关的贷款账户ID列表
   */
  private async getAdminLoanAccountIds(adminId: number): Promise<{
    loanAccountIds: string[];
    admin: { role: ManagementRoles } | null;
  }> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { role: true },
    });

    if (!admin || admin.role === 'ADMIN') {
      return { loanAccountIds: [], admin };
    }

    const loanAccountRoles = await this.prisma.loanAccountRole.findMany({
      where: {
        admin_id: adminId,
      },
      select: {
        loan_account_id: true,
      },
      distinct: ['loan_account_id'],
    });

    const loanAccountIds = loanAccountRoles.map((role) => role.loan_account_id);

    return { loanAccountIds, admin };
  }

  /**
   * 基于 RepaymentSchedule 筛选贷款账户ID
   */
  private async filterLoanIdsByRepaymentSchedule(
    loanAccountIds: string[],
    queryStatus?: string,
    startDate?: string,
    endDate?: string,
    dateField?:
      | 'due_start_date'
      | 'paid_at'
      | 'status_changed_at'
      | 'due_date_range',
  ): Promise<string[]> {
    const scheduleWhere: any = {};

    // 权限过滤
    if (loanAccountIds.length > 0) {
      scheduleWhere.loan_id = { in: loanAccountIds };
    }

    // 状态筛选
    if (queryStatus) {
      scheduleWhere.status = queryStatus;
    }

    // 日期筛选
    if (startDate && endDate && dateField) {
      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);

      if (dateField === 'paid_at') {
        scheduleWhere.due_start_date = {
          gte: startDateObj,
          lte: endDateObj,
        };
      } else if (dateField === 'due_start_date') {
        scheduleWhere.due_start_date = {
          gte: startDateObj,
          lt: endDateObj,
        };
      }
    } else if (startDate && dateField === 'due_start_date') {
      const startDateObj = new Date(startDate);
      const endDateObj = endDate ? new Date(endDate) : new Date();
      scheduleWhere.due_start_date = {
        gte: startDateObj,
        lt: endDateObj,
      };
    }

    // 查询 RepaymentSchedule
    const schedules = await this.prisma.repaymentSchedule.findMany({
      where: scheduleWhere,
      select: { loan_id: true },
      distinct: ['loan_id'],
    });

    const scheduleLoanIds = schedules.map((s) => s.loan_id);

    if (scheduleLoanIds.length === 0) {
      return [];
    }

    // 如果已有权限过滤，取交集；否则使用筛选结果
    return loanAccountIds.length > 0
      ? loanAccountIds.filter((id) => scheduleLoanIds.includes(id))
      : scheduleLoanIds;
  }

  /**
   * 根据归属人筛选贷款账户ID
   */
  private async filterLoanIdsByAdmin(
    loanAccountIds: string[],
    filterAdminId: number,
  ): Promise<string[]> {
    const filterRoles = await this.prisma.loanAccountRole.findMany({
      where: {
        admin_id: filterAdminId,
        role_type: {
          in: ['collector', 'risk_controller'],
        },
      },
      select: {
        loan_account_id: true,
      },
      distinct: ['loan_account_id'],
    });

    const filterLoanAccountIds = filterRoles.map(
      (role) => role.loan_account_id,
    );

    if (filterLoanAccountIds.length === 0) {
      return [];
    }

    // 如果已有权限过滤，取交集；否则使用筛选结果
    return loanAccountIds.length > 0
      ? loanAccountIds.filter((id) => filterLoanAccountIds.includes(id))
      : filterLoanAccountIds;
  }

  /**
   * 构建 LoanAccount 查询条件
   */
  private buildLoanAccountWhere(
    loanAccountIds: string[],
    status?: LoanAccountStatus[],
    tableName?: 'loanAccounts' | 'repaymentSchedule',
    queryStatus?: string,
    startDate?: string,
    endDate?: string,
    dateField?:
      | 'due_start_date'
      | 'paid_at'
      | 'status_changed_at'
      | 'due_date_range',
    keyword?: string,
  ): any {
    const where: any = {};

    // 权限过滤
    if (loanAccountIds.length > 0) {
      where.id = { in: loanAccountIds };
    }

    // 状态过滤
    if (tableName !== 'repaymentSchedule') {
      if (queryStatus) {
        where.status = queryStatus;
      } else if (status && status.length > 0) {
        where.status = { in: status };
      }
    } else if (status && status.length > 0) {
      where.status = { in: status };
    }

    // 处理基于 LoanAccount 的日期筛选
    if (tableName === 'loanAccounts' || !tableName) {
      if (startDate && endDate && dateField) {
        const startDateObj = new Date(startDate);
        const endDateObj = new Date(endDate);

        if (dateField === 'status_changed_at') {
          where.status_changed_at = {
            gte: startDateObj,
            lte: endDateObj,
          };
        } else if (dateField === 'due_start_date') {
          where.due_start_date = {
            gte: startDateObj,
            lte: endDateObj,
          };
        } else if (dateField === 'due_date_range') {
          where.due_start_date = {
            gte: startDateObj,
          };
          where.due_end_date = {
            lte: endDateObj,
          };
        }
      }
    }

    // 客户名字模糊搜索
    if (keyword && keyword.trim()) {
      where.user = {
        username: {
          contains: keyword.trim(),
        },
      };
    }

    return where;
  }

  /**
   * 获取今天和明天的日期（UTC）
   */
  private getTodayAndTomorrowDates(): {
    today: Date;
    tomorrow: Date;
    dayAfterTomorrow: Date;
  } {
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setUTCDate(dayAfterTomorrow.getUTCDate() + 1);

    return { today, tomorrow, dayAfterTomorrow };
  }

  /**
   * 构建还款计划状态映射
   */
  private async buildScheduleMap(loanIds: string[]): Promise<
    Map<
      string,
      {
        todayPaid: boolean;
        tomorrowPaid: boolean;
        hasToday: boolean;
        hasTomorrow: boolean;
      }
    >
  > {
    const { today, tomorrow, dayAfterTomorrow } =
      this.getTodayAndTomorrowDates();

    // 批量查询所有贷款的当天和明天的还款计划
    const todayTomorrowSchedules = await this.prisma.repaymentSchedule.findMany(
      {
        where: {
          loan_id: { in: loanIds },
          due_start_date: {
            gte: today,
            lt: dayAfterTomorrow,
          },
        },
        select: {
          loan_id: true,
          due_start_date: true,
          status: true,
        },
      },
    );

    // 初始化映射
    const scheduleMap = new Map<
      string,
      {
        todayPaid: boolean;
        tomorrowPaid: boolean;
        hasToday: boolean;
        hasTomorrow: boolean;
      }
    >();

    loanIds.forEach((loanId) => {
      scheduleMap.set(loanId, {
        todayPaid: false,
        tomorrowPaid: false,
        hasToday: false,
        hasTomorrow: false,
      });
    });

    // 将 today 和 tomorrow 转换为日期字符串用于比较
    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // 填充映射
    todayTomorrowSchedules.forEach((schedule) => {
      const scheduleDate = new Date(schedule.due_start_date);
      const scheduleYear = scheduleDate.getUTCFullYear();
      const scheduleMonth = String(scheduleDate.getUTCMonth() + 1).padStart(
        2,
        '0',
      );
      const scheduleDay = String(scheduleDate.getUTCDate()).padStart(2, '0');
      const scheduleDateStr = `${scheduleYear}-${scheduleMonth}-${scheduleDay}`;

      const isToday = scheduleDateStr === todayStr;
      const isTomorrow = scheduleDateStr === tomorrowStr;
      const isPaid = schedule.status === 'paid';

      const current = scheduleMap.get(schedule.loan_id) || {
        todayPaid: false,
        tomorrowPaid: false,
        hasToday: false,
        hasTomorrow: false,
      };

      if (isToday) {
        current.hasToday = true;
        if (isPaid) {
          current.todayPaid = true;
        }
      }
      if (isTomorrow) {
        current.hasTomorrow = true;
        if (isPaid) {
          current.tomorrowPaid = true;
        }
      }

      scheduleMap.set(schedule.loan_id, current);
    });

    // 调试：打印 scheduleMap 的内容（仅在开发环境）
    if (process.env.NODE_ENV === 'development') {
      console.log('ScheduleMap 统计:', {
        totalLoans: loanIds.length,
        totalSchedules: todayTomorrowSchedules.length,
        todayCount: Array.from(scheduleMap.values()).filter((v) => v.hasToday)
          .length,
        tomorrowCount: Array.from(scheduleMap.values()).filter(
          (v) => v.hasTomorrow,
        ).length,
        todayPaidCount: Array.from(scheduleMap.values()).filter(
          (v) => v.hasToday && v.todayPaid,
        ).length,
        todayUnpaidCount: Array.from(scheduleMap.values()).filter(
          (v) => v.hasToday && !v.todayPaid,
        ).length,
      });
    }

    return scheduleMap;
  }

  /**
   * 获取状态排序优先级
   */
  private getStatusOrder(status: LoanAccountStatus): number {
    if (status === 'pending') return 1;
    if (status === 'settled') return 2;
    if (status === 'negotiated') return 3;
    if (status === 'blacklist') return 4;
    return 5; // 其他状态排在最后
  }

  /**
   * 获取还款状态排序优先级
   * 1. 今天未还的（有今天的还款计划且未还）
   * 2. 今天已还的（有今天的还款计划且已还）
   * 3. 明天未还的（有明天的还款计划且未还）
   * 4. 明天已还的（有明天的还款计划且已还）
   * 5. 其他（没有今天或明天的还款计划）
   */
  private getPaymentStatusOrder(
    loanId: string,
    scheduleMap: Map<
      string,
      {
        todayPaid: boolean;
        tomorrowPaid: boolean;
        hasToday: boolean;
        hasTomorrow: boolean;
      }
    >,
  ): number {
    const scheduleInfo = scheduleMap.get(loanId) || {
      todayPaid: false,
      tomorrowPaid: false,
      hasToday: false,
      hasTomorrow: false,
    };

    // 优先处理今天的还款计划
    if (scheduleInfo.hasToday) {
      return scheduleInfo.todayPaid ? 2 : 1;
    }

    // 其次处理明天的还款计划
    if (scheduleInfo.hasTomorrow) {
      return scheduleInfo.tomorrowPaid ? 4 : 3;
    }

    // 没有今天或明天的还款计划
    return 5;
  }

  /**
   * 对贷款列表进行排序
   */
  private sortLoans(
    loans: LoanAccount[],
    scheduleMap: Map<
      string,
      {
        todayPaid: boolean;
        tomorrowPaid: boolean;
        hasToday: boolean;
        hasTomorrow: boolean;
      }
    >,
  ): LoanAccount[] {
    return loans.sort((a, b) => {
      // 第一优先级：按 status 排序
      const orderA = this.getStatusOrder(a.status);
      const orderB = this.getStatusOrder(b.status);
      if (orderA !== orderB) {
        return orderA - orderB;
      }

      // 第二优先级：按还款状态排序（今天/明天是否已还）
      const paymentOrderA = this.getPaymentStatusOrder(a.id, scheduleMap);
      const paymentOrderB = this.getPaymentStatusOrder(b.id, scheduleMap);
      if (paymentOrderA !== paymentOrderB) {
        return paymentOrderA - paymentOrderB;
      }

      // 第三优先级：如果 status 和还款状态都相同，按 apply_times 排序
      return a.apply_times - b.apply_times;
    });
  }

  /**
   * 计算统计数据
   */
  private calculateStatistics(loans: LoanAccount[]): {
    inStock: number;
    handlingFee: number;
    fines: number;
    remainingDebt: number;
  } {
    let inStock = 0;
    let handlingFee = 0;
    let fines = 0;
    let remainingDebt = 0;

    loans.forEach((loan) => {
      const loanAmount = Number(loan.loan_amount) || 0;
      const paidCapital = Number(loan.paid_capital) || 0;
      const handlingFeeValue = Number(loan.handling_fee) || 0;
      const finesValue = Number(loan.total_fines) || 0;

      handlingFee += handlingFeeValue;
      fines += finesValue;

      if (loan.status === 'pending' || loan.status === 'negotiated') {
        inStock += loanAmount;
        remainingDebt += Math.max(0, loanAmount - paidCapital);
      }
    });

    return { inStock, handlingFee, fines, remainingDebt };
  }

  /**
   * 从贷款列表中提取相关管理员列表
   */
  private extractRelatedAdminsFromLoans(
    loans: Array<
      LoanAccount & {
        risk_controller?: { id: number; username: string } | null;
        collector?: { id: number; username: string } | null;
      }
    >,
    admin: { role: ManagementRoles } | null,
  ): Array<{ id: number; username: string; role: string }> {
    const relatedAdminsMap = new Map<
      number,
      { id: number; username: string; role: string }
    >();

    loans.forEach((loan) => {
      if (admin && admin.role === 'COLLECTOR') {
        // 负责人访问：提取关联的风控人
        if (loan.risk_controller) {
          if (!relatedAdminsMap.has(loan.risk_controller.id)) {
            relatedAdminsMap.set(loan.risk_controller.id, {
              id: loan.risk_controller.id,
              username: loan.risk_controller.username,
              role: 'RISK_CONTROLLER',
            });
          }
        }
      } else if (admin && admin.role === 'RISK_CONTROLLER') {
        // 风控人访问：提取关联的负责人
        if (loan.collector) {
          if (!relatedAdminsMap.has(loan.collector.id)) {
            relatedAdminsMap.set(loan.collector.id, {
              id: loan.collector.id,
              username: loan.collector.username,
              role: 'COLLECTOR',
            });
          }
        }
      } else if (admin && admin.role === 'ADMIN') {
        // 管理员访问：提取所有负责人和风控人
        if (loan.collector) {
          if (!relatedAdminsMap.has(loan.collector.id)) {
            relatedAdminsMap.set(loan.collector.id, {
              id: loan.collector.id,
              username: loan.collector.username,
              role: 'COLLECTOR',
            });
          }
        }
        if (loan.risk_controller) {
          if (!relatedAdminsMap.has(loan.risk_controller.id)) {
            relatedAdminsMap.set(loan.risk_controller.id, {
              id: loan.risk_controller.id,
              username: loan.risk_controller.username,
              role: 'RISK_CONTROLLER',
            });
          }
        }
      }
    });

    return Array.from(relatedAdminsMap.values()).sort((a, b) =>
      a.username.localeCompare(b.username),
    );
  }

  async findGroupedByUser(
    status?: LoanAccountStatus[],
    adminId?: number,
    page?: number,
    pageSize?: number,
    filterAdminId?: number,
    tableName?: 'loanAccounts' | 'repaymentSchedule',
    startDate?: string,
    endDate?: string,
    queryStatus?: string,
    dateField?:
      | 'due_start_date'
      | 'paid_at'
      | 'status_changed_at'
      | 'due_date_range',
    keyword?: string,
  ): Promise<{
    statistics: {
      inStock: number;
      handlingFee: number;
      fines: number;
      remainingDebt: number;
    };
    data: LoanAccount[];
    total: number;
    relatedAdmins: Array<{ id: number; username: string; role: string }>;
  }> {
    // 1. 权限过滤：获取该admin相关的所有loan_account_ids
    let loanAccountIds: string[] = [];
    let admin: { role: ManagementRoles } | null = null;

    if (adminId) {
      const result = await this.getAdminLoanAccountIds(adminId);
      loanAccountIds = result.loanAccountIds;
      admin = result.admin;

      if (loanAccountIds.length === 0 && admin && admin.role !== 'ADMIN') {
        return this.getEmptyResult();
      }
    }

    // 2. 基于 RepaymentSchedule 的筛选
    if (tableName === 'repaymentSchedule') {
      loanAccountIds = await this.filterLoanIdsByRepaymentSchedule(
        loanAccountIds,
        queryStatus,
        startDate,
        endDate,
        dateField,
      );

      if (loanAccountIds.length === 0) {
        return this.getEmptyResult();
      }
    }

    // 3. 归属人筛选
    if (filterAdminId) {
      loanAccountIds = await this.filterLoanIdsByAdmin(
        loanAccountIds,
        filterAdminId,
      );

      if (loanAccountIds.length === 0) {
        return this.getEmptyResult();
      }
    }

    // 4. 构建查询条件
    const where = this.buildLoanAccountWhere(
      loanAccountIds,
      status,
      tableName,
      queryStatus,
      startDate,
      endDate,
      dateField,
      keyword,
    );

    // 调试：打印查询条件
    if (queryStatus === 'overdue' && dateField === 'due_start_date') {
      console.log(
        'LoanAccount 查询条件 where:',
        JSON.stringify(where, null, 2),
      );
      console.log('loanAccountIds 数量:', loanAccountIds.length);
    }

    // 5. 查询 LoanAccount 数据
    const loans = await this.prisma.loanAccount.findMany({
      where,
      include: {
        user: true,
        risk_controller: { select: { id: true, username: true } },
        collector: { select: { id: true, username: true } },
        lender: { select: { id: true, username: true } },
      },
    });

    // 调试：打印查询结果
    if (queryStatus === 'overdue' && dateField === 'due_start_date') {
      console.log('LoanAccount 查询结果数量:', loans.length);
      console.log(
        '查询到的 loan IDs:',
        loans.map((l) => l.id),
      );
    }

    // 6. 构建还款计划状态映射
    const allLoanIds = loans.map((loan) => loan.id);
    const scheduleMap = await this.buildScheduleMap(allLoanIds);

    // 7. 排序
    const sortedLoans = this.sortLoans(loans, scheduleMap);

    // 8. 计算统计数据
    const statistics = this.calculateStatistics(sortedLoans);

    // 9. 获取相关管理员列表
    const relatedAdmins = this.extractRelatedAdminsFromLoans(
      sortedLoans,
      admin,
    );

    // 10. 分页处理
    let paginatedLoans = sortedLoans;
    if (page !== undefined && pageSize !== undefined) {
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      paginatedLoans = sortedLoans.slice(startIndex, endIndex);
    }

    // 11. 为每个 loan 添加 today_paid 和 tomorrow_paid 字段
    const processedLoans = paginatedLoans.map((loan) => {
      const scheduleInfo = scheduleMap.get(loan.id) || {
        todayPaid: false,
        tomorrowPaid: false,
        hasToday: false,
        hasTomorrow: false,
      };
      return {
        ...loan,
        today_paid: scheduleInfo.todayPaid,
        tomorrow_paid: scheduleInfo.tomorrowPaid,
      };
    });

    return {
      statistics,
      data: processedLoans,
      total: sortedLoans.length,
      relatedAdmins,
    };
  }

  findByUserId(userId: number): Promise<LoanAccount[]> {
    return this.prisma.loanAccount.findMany({
      where: { user_id: userId },
      include: { user: true },
      orderBy: { created_at: 'desc' },
    });
  }

  async findLatestByUserId(userId: number): Promise<LoanAccount | null> {
    const loan = await this.prisma.loanAccount.findFirst({
      where: { user_id: userId },
      include: {
        user: true,
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
        lender: {
          select: {
            id: true,
            username: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    return loan;
  }

  async update(id: string, data: UpdateLoanAccountDto): Promise<LoanAccount> {
    return await this.prisma.$transaction(async (tx) => {
      // 获取更新前的数据，用于判断 due_start_date 是否改变
      const oldLoan = await tx.loanAccount.findUnique({
        where: { id },
        select: { due_start_date: true },
      });

      if (!oldLoan) {
        throw new Error('贷款记录不存在');
      }

      const updateData: any = {};
      let newDueStartDate: Date | null = null;

      // 处理日期字段（日期类型，不包含时间）
      // 使用 UTC 时间的午夜来创建日期，避免时区转换问题
      if (data.due_start_date) {
        // 解析 YYYY-MM-DD 格式的日期字符串
        const dateMatch = data.due_start_date.match(
          /^(\d{4})-(\d{2})-(\d{2})$/,
        );
        if (dateMatch) {
          const [, year, month, day] = dateMatch;
          // 使用 UTC 时间创建日期，避免时区转换导致的日期偏移
          const startDate = new Date(
            Date.UTC(Number(year), Number(month) - 1, Number(day)),
          );
          updateData.due_start_date = startDate;
          newDueStartDate = startDate;
        }
      }

      if (data.due_end_date) {
        // 解析 YYYY-MM-DD 格式的日期字符串
        const dateMatch = data.due_end_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateMatch) {
          const [, year, month, day] = dateMatch;
          // 使用 UTC 时间创建日期，避免时区转换导致的日期偏移
          const endDate = new Date(
            Date.UTC(Number(year), Number(month) - 1, Number(day)),
          );
          updateData.due_end_date = endDate;
        }
      }

      // 处理数值字段
      if (data.loan_amount !== undefined)
        updateData.loan_amount = data.loan_amount;
      if (data.receiving_amount !== undefined)
        updateData.receiving_amount = data.receiving_amount;
      if (data.to_hand_ratio !== undefined)
        updateData.to_hand_ratio = data.to_hand_ratio;
      if (data.capital !== undefined) updateData.capital = data.capital;
      if (data.interest !== undefined) updateData.interest = data.interest;
      if (data.handling_fee !== undefined)
        updateData.handling_fee = data.handling_fee;
      if (data.total_periods !== undefined)
        updateData.total_periods = data.total_periods;
      if (data.repaid_periods !== undefined)
        updateData.repaid_periods = data.repaid_periods;
      if (data.daily_repayment !== undefined)
        updateData.daily_repayment = data.daily_repayment;
      if (data.status !== undefined)
        updateData.status = data.status as LoanAccountStatus;
      if (data.company_cost !== undefined)
        updateData.company_cost = data.company_cost;
      if (data.apply_times !== undefined)
        updateData.apply_times = data.apply_times;

      // 处理管理员ID字段
      if (data.risk_controller_id !== undefined) {
        updateData.risk_controller_id = data.risk_controller_id;
      }
      if (data.collector_id !== undefined) {
        updateData.collector_id = data.collector_id;
      }
      if (data.lender_id !== undefined) {
        updateData.lender_id = data.lender_id;
      }

      // 处理备注字段
      if (data.note !== undefined) {
        updateData.note = data.note;
      }

      // 更新 LoanAccount
      const updated = await tx.loanAccount.update({
        where: { id },
        data: updateData,
        include: {
          user: true,
          repaymentSchedules: true,
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
          lender: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      // 如果 due_start_date 改变了，同步更新所有相关的 RepaymentSchedule
      if (newDueStartDate && oldLoan.due_start_date) {
        const oldStartDate = new Date(oldLoan.due_start_date);

        // 比较日期（只比较年月日，忽略时间）
        // 使用 UTC 日期格式化，避免时区转换问题
        const formatUTCDate = (date: Date): string => {
          const year = date.getUTCFullYear();
          const month = String(date.getUTCMonth() + 1).padStart(2, '0');
          const day = String(date.getUTCDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };
        const oldDateStr = formatUTCDate(oldStartDate);
        const newDateStr = formatUTCDate(newDueStartDate);

        if (oldDateStr !== newDateStr) {
          // 获取所有相关的还款计划，按 period 排序
          const schedules = await tx.repaymentSchedule.findMany({
            where: { loan_id: id },
            orderBy: { period: 'asc' },
            select: { id: true, period: true },
          });

          // 更新每个还款计划的日期和状态
          for (const schedule of schedules) {
            // 计算新的开始日期：第一期使用新的 due_start_date，后续每期依次往后延
            // 第一期：period = 1，所以加 0 天
            // 第二期：period = 2，所以加 1 天
            // 第三期：period = 3，所以加 2 天
            // 使用 UTC 时间计算，避免时区转换问题
            const baseDate = new Date(newDueStartDate);
            const newStartDate = new Date(
              Date.UTC(
                baseDate.getUTCFullYear(),
                baseDate.getUTCMonth(),
                baseDate.getUTCDate() + (schedule.period - 1),
              ),
            );

            // 获取当前还款计划的状态，用于判断新状态
            const currentSchedule = await tx.repaymentSchedule.findUnique({
              where: { id: schedule.id },
              select: { status: true },
            });

            // 根据新的日期判断应该的状态（周期是一天，所以使用due_start_date）
            const newStatus = this.determineScheduleStatus(
              newStartDate,
              currentSchedule?.status || 'pending',
            );

            await tx.repaymentSchedule.update({
              where: { id: schedule.id },
              data: {
                due_start_date: newStartDate,
                status: newStatus,
              },
            });
          }
          const overdueSchedules = await tx.repaymentSchedule.findMany({
            where: {
              loan_id: id,
              status: 'overdue',
            },
          });
          await tx.loanAccount.update({
            where: { id: id },
            data: { overdue_count: overdueSchedules.length },
          });
        }
      }

      // 如果更新了管理员ID，需要同步更新 LoanAccountRole
      if (
        data.risk_controller_id !== undefined ||
        data.collector_id !== undefined ||
        data.lender_id !== undefined
      ) {
        // 删除旧的角色记录
        if (data.risk_controller_id !== undefined) {
          await tx.loanAccountRole.deleteMany({
            where: {
              loan_account_id: id,
              role_type: 'risk_controller',
            },
          });
          await tx.loanAccountRole.create({
            data: {
              loan_account_id: id,
              admin_id: data.risk_controller_id,
              role_type: 'risk_controller',
            },
          });
        }

        if (data.collector_id !== undefined) {
          await tx.loanAccountRole.deleteMany({
            where: {
              loan_account_id: id,
              role_type: 'collector',
            },
          });
          await tx.loanAccountRole.create({
            data: {
              loan_account_id: id,
              admin_id: data.collector_id,
              role_type: 'collector',
            },
          });
        }

        if (data.lender_id !== undefined) {
          await tx.loanAccountRole.deleteMany({
            where: {
              loan_account_id: id,
              role_type: 'lender',
            },
          });
          await tx.loanAccountRole.create({
            data: {
              loan_account_id: id,
              admin_id: data.lender_id,
              role_type: 'lender',
            },
          });
        }
      }

      // 重新获取更新后的数据（包含更新后的还款计划）
      const finalUpdated = await tx.loanAccount.findUnique({
        where: { id },
        include: {
          user: true,
          repaymentSchedules: true,
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
          lender: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      return finalUpdated!;
    });
  }

  async updateStatus(
    id: string,
    newStatus: LoanAccountStatus,
    options?: {
      settlementCapital?: number;
      orderId?: string;
      settlementDate?: string;
    },
    userId?: number | null,
  ): Promise<LoanAccount> {
    // 检查贷款记录是否存在
    const loan = await this.prisma.loanAccount.findUnique({
      where: { id },
      include: {
        repaymentSchedules: true,
      },
    });

    if (!loan) {
      throw new Error('贷款记录不存在');
    }

    // 如果新状态是 settled（已结清）或 blacklist（黑名单），
    // 需要：
    // 1. 以前端传入的 settlementDate 为分界线
    // 2. 之前的计划保持不变，当天及以后的计划状态改为 terminated
    // 3. 不更新 repaid_periods，保持原值
    if (newStatus === 'settled' || newStatus === 'blacklist') {
      const updated = await this.prisma.$transaction(async (tx) => {
        // 解析前端传入的结清/拉黑日期
        let settlementDate: Date;
        if (options?.settlementDate) {
          // 解析 YYYY-MM-DD 格式的日期字符串
          const dateMatch = options.settlementDate.match(
            /^(\d{4})-(\d{2})-(\d{2})$/,
          );
          if (dateMatch) {
            const [, year, month, day] = dateMatch;
            settlementDate = new Date(
              Date.UTC(Number(year), Number(month) - 1, Number(day)),
            );
          } else {
            settlementDate = new Date(options.settlementDate);
          }
        } else {
          // 如果没有传入日期，使用今天
          const now = new Date();
          settlementDate = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
          );
        }

        let order;
        if (options?.orderId) {
          order = await tx.order.findUnique({
            where: { id: options.orderId },
          });
          await tx.order.update({
            where: { id: options.orderId },
            data: {
              manual_processing_status: 'processed',
              needs_manual_processing: false,
            },
          });
        }
        // 获取所有关联的还款计划
        const schedules = await tx.repaymentSchedule.findMany({
          where: { loan_id: id },
        });

        // 以 settlementDate 为分界线，将计划分为两类
        const settlementDateStart = new Date(
          Date.UTC(
            settlementDate.getUTCFullYear(),
            settlementDate.getUTCMonth(),
            settlementDate.getUTCDate(),
            0,
            0,
            0,
            0,
          ),
        );
        const settlementDateEnd = new Date(
          Date.UTC(
            settlementDate.getUTCFullYear(),
            settlementDate.getUTCMonth(),
            settlementDate.getUTCDate(),
            23,
            59,
            59,
          ),
        );

        // 以后的计划：状态改为 terminated
        const schedulesToTerminate = schedules.filter((s) => {
          if (s.status === 'active' || s.status === 'paid') return false;
          return s.due_start_date >= settlementDateStart;
        });

        // 更新当天以后的计划状态为 terminated
        if (schedulesToTerminate.length > 0) {
          await tx.repaymentSchedule.updateMany({
            where: {
              loan_id: id,
              id: {
                in: schedulesToTerminate.map((s) => s.id),
              },
            },
            data: {
              status: 'terminated' as RepaymentScheduleStatus,
            },
          });
        }

        // 结清/拉黑前累计的已收金额（统计所有计划）
        const prevTotalReceiving = schedules.reduce(
          (sum, s) => sum + this.toNumber(s.paid_amount),
          0,
        );

        // 结清/拉黑前累计的已收本金和利息（用于更新 LoanAccount 的已收本金/利息）
        const prevPaidCapital = schedules.reduce(
          (sum, s) => sum + this.toNumber(s.paid_capital),
          0,
        );
        // 结清使用的本金和利息（如果前端传入则优先使用）
        const manualCapital = options?.settlementCapital ?? 0;
        const hasManualSettlement = manualCapital > 0;

        let settlementAmount: number;
        let receivingAmount: number;

        // 使用用户输入的本金 + 利息 作为本次结清/拉黑金额（如果有）
        if (hasManualSettlement) {
          settlementAmount = manualCapital;
        } else {
          settlementAmount = 0;
        }

        // 结清/拉黑后的应收总额：
        // = 已还本金 + 已还利息（截至结清前）+ 提前结清的本金
        receivingAmount = prevTotalReceiving + manualCapital;

        // 若有结清/拉黑金额，创建或更新一条提前结清的还款记录 + 完成订单
        if (settlementAmount > 0) {
          // 获取用户
          const la = await tx.loanAccount.findUnique({
            where: { id },
            select: { user_id: true },
          });
          let payee = null as null | { id: number };

          // 查找是否已存在提前结清的还款记录
          const existingRecord = await tx.repaymentRecord.findFirst({
            where: {
              loan_id: id,
              remark: '来源：提前结清',
            },
            include: {
              order: true,
            },
          });

          if (existingRecord) {
            // 更新还款记录
            await tx.repaymentRecord.update({
              where: { id: existingRecord.id },
              data: {
                paid_amount: settlementAmount,
                paid_amount_decimal:
                  order?.actual_paid_amount ?? Number(settlementAmount),
                paid_at: new Date(),
                payment_method: PaymentMethod.wechat_pay,
                actual_collector_id: order?.actual_collector_id ?? userId,
                remark: '来源：提前结清',
                paid_capital: hasManualSettlement
                  ? Number(manualCapital)
                  : null,
              },
            });
          } else {
            // 创建还款记录
            await tx.repaymentRecord.create({
              data: {
                loan_id: id,
                user_id: la!.user_id,
                paid_amount: settlementAmount,
                paid_amount_decimal:
                  order?.actual_paid_amount ?? Number(settlementAmount),
                paid_at: new Date(),
                payment_method: PaymentMethod.wechat_pay,
                actual_collector_id: order?.actual_collector_id ?? userId,
                remark: '来源：提前结清',
                paid_capital: hasManualSettlement
                  ? Number(manualCapital)
                  : null,
              },
            });
          }
        }

        // 更新贷款账户（不更新 repaid_periods，保持原值）
        const updateData: any = {
          status: newStatus,
          receiving_amount: receivingAmount,
          due_end_date: settlementDateEnd,
        };

        updateData.status_changed_at = new Date();

        // 如果使用了手动结清的本金，更新到 LoanAccount
        if (hasManualSettlement) {
          // 前端传入的结清本金/利息是针对「当天及以后」的还款计划，
          // 因此 LoanAccount 层面的已收本金/利息 = 之前历史已收 + 本次结清金额
          updateData.paid_capital = prevPaidCapital + manualCapital;
          // 仅在前端有传值时记录提前结清部分，避免被写成 0 覆盖原值
          if (options?.settlementCapital !== undefined) {
            (updateData as any).early_settlement_capital = manualCapital;
          }
        } else {
          // 否则从还款计划中计算
          const loanPaidCapital = schedules.reduce(
            (sum, s) => sum + this.toNumber(s.paid_capital),
            0,
          );
          updateData.paid_capital = loanPaidCapital;
        }

        const updated = await tx.loanAccount.update({
          where: { id },
          data: updateData,
          include: {
            user: true,
            repaymentSchedules: {
              orderBy: {
                period: 'asc',
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
            lender: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        });

        return updated;
      });

      return updated;
    } else {
      // 对于其他状态，直接更新
      const updateData: any = {
        status: newStatus,
      };
      // 如果状态变更为negotiated，更新status_changed_at（blacklist 在上面的分支已处理）
      if (newStatus === 'negotiated') {
        updateData.status_changed_at = new Date();
      }
      const updated = await this.prisma.loanAccount.update({
        where: { id },
        data: updateData,
        include: {
          user: true,
          repaymentSchedules: {
            orderBy: {
              period: 'asc',
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
          lender: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      return updated;
    }
  }

  async delete(id: string, force: boolean = false): Promise<void> {
    // 检查记录是否存在
    const loan = await this.prisma.loanAccount.findUnique({
      where: { id },
    });

    if (!loan) {
      throw new Error('贷款记录不存在');
    }

    if (force) {
      // 强制删除：先删除关联的 RepaymentRecord，再删除 LoanAccount
      await this.prisma.$transaction(async (tx) => {
        // 1. 删除关联的 RepaymentRecord
        await tx.repaymentRecord.deleteMany({
          where: { loan_id: id },
        });

        // 2. 删除关联的 RepaymentSchedule（已有级联删除，但显式删除更安全）
        await tx.repaymentSchedule.deleteMany({
          where: { loan_id: id },
        });

        // 3. 删除关联的 LoanAccountRole（已有级联删除，但显式删除更安全）
        await tx.loanAccountRole.deleteMany({
          where: { loan_account_id: id },
        });

        // 4. 删除 LoanAccount
        await tx.loanAccount.delete({
          where: { id },
        });
      });
    } else {
      // 普通删除：尝试直接删除，如果失败会抛出错误
      try {
        await this.prisma.loanAccount.delete({
          where: { id },
        });
      } catch (error: any) {
        // 检查是否是外键约束错误
        if (
          error.code === 'P2003' ||
          error.message?.includes('Foreign key constraint') ||
          error.message?.includes('repaymentRecord')
        ) {
          throw new Error(
            'CONSTRAINT_ERROR: 该贷款记录存在关联的还款记录，无法删除。是否强制删除？',
          );
        }
        throw error;
      }
    }
  }

  async exportAdminReport(): Promise<Buffer> {
    const loans = await this.prisma.loanAccount.findMany({
      include: {
        user: {
          select: {
            username: true,
          },
        },
        collector: {
          select: {
            id: true,
            username: true,
          },
        },
        risk_controller: {
          select: {
            id: true,
            username: true,
          },
        },
        repaymentSchedules: {
          select: {
            due_start_date: true,
            capital: true,
            interest: true,
          },
          orderBy: {
            due_start_date: 'asc',
          },
        },
      },
      orderBy: [{ created_at: 'asc' }],
    });

    const collectorSummaries = new Map<string, AdminReportSummaryEntry>();
    const riskSummaries = new Map<string, AdminReportSummaryEntry>();
    const collectorDetails = new Map<string, AdminReportDetailRow[]>();
    const riskDetails = new Map<string, AdminReportDetailRow[]>();

    loans.forEach((loan) => {
      const loanAmount = this.toNumber(loan.loan_amount);
      const receivingAmount = this.toNumber(loan.receiving_amount);
      const capital = this.toNumber(loan.capital);
      const interest = this.toNumber(loan.interest);
      const toHandRatio = this.toNumber(loan.to_hand_ratio);
      const handlingFee = this.toNumber(loan.handling_fee);
      const companyCost = this.toNumber(loan.company_cost);
      const repaidPeriods = loan.repaid_periods ?? 0;
      const applyTimes = loan.apply_times ?? 1;

      const receivedPrincipal = capital * repaidPeriods;
      const receivedInterest = interest * repaidPeriods;
      const outstandingPrincipal = loanAmount - receivedPrincipal;
      const commission = loanAmount * toHandRatio;
      const handlingRate = loanAmount !== 0 ? handlingFee / loanAmount : 0;
      const totalReceived = receivingAmount;
      const pendingPrincipal = loanAmount - totalReceived;
      const profit = totalReceived - loanAmount + commission;
      const repaymentSchedules = (loan.repaymentSchedules ?? [])
        .map((schedule) => {
          if (!schedule.due_start_date) {
            return null;
          }
          return {
            dueDate: new Date(schedule.due_start_date),
            principal: this.toNumber(schedule.capital),
            interest: this.toNumber(schedule.interest),
          };
        })
        .filter(
          (
            item,
          ): item is {
            dueDate: Date;
            principal: number;
            interest: number;
          } => item !== null,
        );

      const collectorName = loan.collector?.username || '未分配负责人';
      const riskControllerName =
        loan.risk_controller?.username || '未分配风控人';

      const detailRow: AdminReportDetailRow = {
        userName: loan.user?.username || '',
        status: loan.status,
        date: loan.due_start_date ? new Date(loan.due_start_date) : null,
        applyTimes,
        loanAmount,
        totalReceived,
        receivedPrincipal,
        receivedInterest,
        outstandingPrincipal,
        ratio: toHandRatio,
        commission,
        handlingRate,
        handlingFee,
        profit,
        collectorName,
        riskControllerName,
        paidPeriods: repaidPeriods,
        totalPeriods: loan.total_periods ?? repaymentSchedules.length,
        repaymentSchedules,
      };

      this.pushDetail(collectorDetails, collectorName, detailRow);
      this.pushDetail(riskDetails, riskControllerName, detailRow);

      this.accumulateSummary(
        collectorSummaries,
        collectorName,
        loanAmount,
        companyCost,
        pendingPrincipal,
        totalReceived,
        receivedPrincipal,
        receivedInterest,
        commission,
        handlingFee,
      );

      this.accumulateSummary(
        riskSummaries,
        riskControllerName,
        loanAmount,
        companyCost,
        pendingPrincipal,
        totalReceived,
        receivedPrincipal,
        receivedInterest,
        commission,
        handlingFee,
      );
    });

    const workbookData = {
      collectorsSummary: Array.from(collectorSummaries.values()).sort((a, b) =>
        a.name.localeCompare(b.name, 'zh-CN'),
      ),
      riskControllersSummary: Array.from(riskSummaries.values()).sort((a, b) =>
        a.name.localeCompare(b.name, 'zh-CN'),
      ),
      collectorDetails: Array.from(collectorDetails.entries())
        .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
        .map(([name, rows]) => ({
          name,
          rows,
        })),
      riskControllerDetails: Array.from(riskDetails.entries())
        .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
        .map(([name, rows]) => ({
          name,
          rows,
        })),
      generatedAt: new Date(),
    };

    return this.excelExportService.generateAdminReport(workbookData);
  }

  private pushDetail(
    map: Map<string, AdminReportDetailRow[]>,
    key: string,
    row: AdminReportDetailRow,
  ) {
    const list = map.get(key);
    if (list) {
      list.push(row);
    } else {
      map.set(key, [row]);
    }
  }

  private accumulateSummary(
    map: Map<string, AdminReportSummaryEntry>,
    key: string,
    loanAmount: number,
    companyCost: number,
    pendingPrincipal: number,
    totalReceived: number,
    receivedPrincipal: number,
    receivedInterest: number,
    commission: number,
    withholding: number,
  ) {
    const summary =
      map.get(key) ||
      ({
        name: key,
        loanAmount: 0,
        companyCost: 0,
        pendingPrincipal: 0,
        totalReceived: 0,
        receivedPrincipal: 0,
        receivedInterest: 0,
        commission: 0,
        withholding: 0,
      } as AdminReportSummaryEntry);

    summary.loanAmount += loanAmount;
    summary.companyCost += companyCost;
    summary.pendingPrincipal += pendingPrincipal;
    summary.totalReceived += totalReceived;
    summary.receivedPrincipal += receivedPrincipal;
    summary.receivedInterest += receivedInterest;
    summary.commission += commission;
    summary.withholding += withholding;

    map.set(key, summary);
  }

  private toNumber(value: any): number {
    if (value === null || value === undefined) {
      return 0;
    }
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const n = Number(value);
      return Number.isNaN(n) ? 0 : n;
    }
    if (typeof value === 'object' && 'toNumber' in value) {
      try {
        return (value as any).toNumber();
      } catch {
        return Number(value) || 0;
      }
    }
    return Number(value) || 0;
  }
}
