import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LoanAccount,
  LoanAccountStatus,
  RepaymentScheduleStatus,
  User,
} from '@prisma/client';
import { CreateLoanAccountDto } from './dto/create-loanAccount.dto';
import { UpdateLoanAccountDto } from './dto/update-loanAccount.dto';
import {
  AdminReportDetailRow,
  AdminReportSummaryEntry,
  ExcelExportService,
} from '../common/excel-export.service';

@Injectable()
export class LoanAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly excelExportService: ExcelExportService,
  ) {}

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
    const startDate = new Date(due_start_date);
    const endDate = new Date(data.due_end_date);
    startDate.setHours(6, 0, 0, 0);
    endDate.setHours(6, 0, 0, 0);

    // 使用事务：创建贷款记录并批量创建还款计划
    const loan = await this.prisma.$transaction(async (tx) => {
      const existingCount = await tx.loanAccount.count({
        where: { user_id: data.user_id },
      });

      const applyTimes = existingCount + 1;

      const created = await tx.loanAccount.create({
        data: {
          user_id: data.user_id,
          loan_amount: data.loan_amount,
          receiving_amount: data.receiving_amount,
          risk_controller_id: data.risk_controller_id,
          collector_id: data.collector_id,
          payee_id: data.payee_id,
          lender_id: data.lender_id,
          company_cost: data.company_cost,
          handling_fee: data.handling_fee as number,
          to_hand_ratio: data.to_hand_ratio as number,
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
        },
      });

      const periods = Number(total_periods) || 0;
      const perAmount = Number(daily_repayment) || created.daily_repayment || 0;

      const rows = Array.from({ length: periods }).map((_, idx) => {
        const d = new Date(created.due_start_date);
        d.setDate(d.getDate() + idx);
        d.setHours(6, 0, 0, 0);
        const end = new Date(d);
        end.setDate(end.getDate() + 1);
        end.setHours(6, 0, 0, 0);
        return {
          loan_id: created.id,
          period: idx + 1,
          due_start_date: d,
          due_end_date: end,
          due_amount: perAmount,
          capital: capital ? Number(capital) : null,
          interest: interest ? Number(interest) : null,
          remaining_capital: capital ? Number(capital) : null,
          remaining_interest: interest ? Number(interest) : null,
          status: data.status as RepaymentScheduleStatus,
        };
      });

      if (rows.length > 0) {
        await tx.repaymentSchedule.createMany({ data: rows });
      }

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
            admin_id: data.payee_id,
            role_type: 'payee',
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
        payee: {
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

    const totalCapital = schedules.reduce(
      (sum, schedule) => sum + sumNumber(schedule.capital),
      0,
    );
    const totalInterest = schedules.reduce(
      (sum, schedule) => sum + sumNumber(schedule.interest),
      0,
    );

    const remainingCapital = schedules.reduce((sum, schedule) => {
      const remaining =
        schedule.remaining_capital !== null &&
        schedule.remaining_capital !== undefined
          ? Number(schedule.remaining_capital)
          : sumNumber(schedule.capital);
      return sum + remaining;
    }, 0);

    const remainingInterest = schedules.reduce((sum, schedule) => {
      const remaining =
        schedule.remaining_interest !== null &&
        schedule.remaining_interest !== undefined
          ? Number(schedule.remaining_interest)
          : sumNumber(schedule.interest);
      return sum + remaining;
    }, 0);

    const paidCapital = Math.max(totalCapital - remainingCapital, 0);
    const paidInterest = Math.max(totalInterest - remainingInterest, 0);

    const totalFines = schedules.reduce(
      (sum, schedule) => sum + sumNumber(schedule.fines),
      0,
    );

    const unpaidCapital = remainingCapital;

    const receivingAmount = schedules.reduce(
      (sum, schedule) => sum + sumNumber(schedule.paid_amount),
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

  async findGroupedByUser(
    status?: LoanAccountStatus[],
    adminId?: number,
  ): Promise<Array<{ user: User; loanAccounts: LoanAccount[] }>> {
    // 构建基础查询条件
    let where: any = {};

    // 如果状态有值，添加状态过滤
    if (status && status.length > 0) {
      where.status = { in: status };
    }

    // 权限过滤：如果不是管理员，则根据 admin_id 过滤
    if (adminId) {
      // 从数据库查询用户角色，确保准确性
      const admin = await this.prisma.admin.findUnique({
        where: { id: adminId },
        select: { role: true },
      });

      // 如果用户角色不是管理员，则根据 admin_id 过滤
      if (admin && admin.role !== '管理员') {
        // 查询该 admin 在 LoanAccountRole 表中关联的所有 loan_account_id
        const loanAccountRoles = await this.prisma.loanAccountRole.findMany({
          where: {
            admin_id: adminId,
          },
          select: {
            loan_account_id: true,
          },
          distinct: ['loan_account_id'],
        });

        const loanAccountIds = loanAccountRoles.map(
          (role) => role.loan_account_id,
        );

        if (loanAccountIds.length === 0) {
          // 如果没有关联的 loan accounts，返回空数组
          return [];
        }

        // 添加 loan_id 过滤条件
        where.id = { in: loanAccountIds };
      }
      // 如果是管理员，不添加过滤条件，可以查看所有数据
    }

    const loans = await this.prisma.loanAccount.findMany({
      where,
      include: {
        user: true,
        risk_controller: { select: { id: true, username: true } },
        collector: { select: { id: true, username: true } },
        payee: { select: { id: true, username: true } },
        lender: { select: { id: true, username: true } },
      },
      orderBy: [{ user_id: 'asc' }, { apply_times: 'asc' }],
    });
    const map = new Map<number, { user: User; loanAccounts: LoanAccount[] }>();
    for (const loan of loans) {
      const user = loan.user as unknown as User;
      const group = map.get(loan.user_id);
      if (!group) {
        map.set(loan.user_id, { user, loanAccounts: [loan] });
      } else {
        group.loanAccounts.push(loan);
      }
    }
    return Array.from(map.values());
  }

  findByUserId(userId: number): Promise<LoanAccount[]> {
    return this.prisma.loanAccount.findMany({
      where: { user_id: userId },
      include: { user: true },
      orderBy: { created_at: 'desc' },
    });
  }

  async update(id: string, data: UpdateLoanAccountDto): Promise<LoanAccount> {
    const updateData: any = {};

    // 处理日期字段
    if (data.due_start_date) {
      const startDate = new Date(data.due_start_date);
      startDate.setHours(6, 0, 0, 0);
      updateData.due_start_date = startDate;
    }

    if (data.due_end_date) {
      const endDate = new Date(data.due_end_date);
      endDate.setHours(6, 0, 0, 0);
      updateData.due_end_date = endDate;
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

    // 处理管理员ID字段
    if (data.risk_controller_id !== undefined) {
      updateData.risk_controller_id = data.risk_controller_id;
    }
    if (data.collector_id !== undefined) {
      updateData.collector_id = data.collector_id;
    }
    if (data.payee_id !== undefined) {
      updateData.payee_id = data.payee_id;
    }
    if (data.lender_id !== undefined) {
      updateData.lender_id = data.lender_id;
    }

    // 更新 LoanAccount
    const updated = await this.prisma.loanAccount.update({
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
        payee: {
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

    // 如果更新了管理员ID，需要同步更新 LoanAccountRole
    if (
      data.risk_controller_id !== undefined ||
      data.collector_id !== undefined ||
      data.payee_id !== undefined ||
      data.lender_id !== undefined
    ) {
      await this.prisma.$transaction(async (tx) => {
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

        if (data.payee_id !== undefined) {
          await tx.loanAccountRole.deleteMany({
            where: {
              loan_account_id: id,
              role_type: 'payee',
            },
          });
          await tx.loanAccountRole.create({
            data: {
              loan_account_id: id,
              admin_id: data.payee_id,
              role_type: 'payee',
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
      });
    }

    return updated;
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
