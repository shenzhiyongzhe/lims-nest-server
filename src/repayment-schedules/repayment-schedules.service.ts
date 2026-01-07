import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RepaymentSchedule,
  RepaymentScheduleStatus,
  OrderStatus,
  PaymentMethod,
} from '@prisma/client';
import { RepaymentScheduleResponseDto } from './dto/repayment-schedule-response.dto';

@Injectable()
export class RepaymentSchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async findByLoanId(loanId: string): Promise<RepaymentSchedule[]> {
    return this.prisma.repaymentSchedule.findMany({
      where: {
        loan_id: loanId,
      },
      orderBy: {
        period: 'asc',
      },
    });
  }

  async findById(id: number): Promise<RepaymentSchedule | null> {
    return this.prisma.repaymentSchedule.findUnique({
      where: { id },
      include: {
        loan_account: {
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
        },
      },
    });
  }

  async update(
    data: Partial<RepaymentSchedule> & {
      pay_capital?: number;
      pay_interest?: number;
      fines?: number;
    },
    operatorAdminId?: number,
  ): Promise<RepaymentSchedule> {
    return await this.prisma.$transaction(async (tx) => {
      // 1. 获取更新前的还款计划数据
      const currentSchedule = await tx.repaymentSchedule.findUnique({
        where: { id: data.id },
        select: {
          loan_id: true,
          capital: true,
          interest: true,
          paid_capital: true,
          paid_interest: true,
          fines: true,
          status: true,
          paid_amount: true,
          operator_admin_name: true,
          due_start_date: true,
        },
      });

      if (!currentSchedule) {
        throw new NotFoundException('还款计划不存在');
      }

      const toNumber = (value?: any) =>
        value !== null && value !== undefined ? Number(value) : 0;

      // 前端传入的 pay_capital / pay_interest 代表「本期已还总金额」，
      const inputCapital = Number(data.pay_capital) || 0;
      const inputInterest = Number(data.pay_interest) || 0;

      const baseCapital = toNumber(currentSchedule.capital);
      const baseInterest = toNumber(currentSchedule.interest);

      const { pay_capital, pay_interest, ...restData } = data;
      const updatePayload: any = {
        ...restData,
        paid_capital: inputCapital,
        paid_interest: inputInterest,
      };

      if (updatePayload.fines !== undefined) {
        updatePayload.fines = Number(updatePayload.fines);
      }

      const finesValue =
        updatePayload.fines !== undefined
          ? Number(updatePayload.fines)
          : toNumber(currentSchedule.fines);

      // 获取操作人名称（用于手动收款写入）
      let operatorName: string | null = null;
      if (operatorAdminId) {
        const op = await this.prisma.admin.findUnique({
          where: { id: operatorAdminId },
          select: { username: true },
        });
        operatorName = op?.username ?? null;
      }
      const paidAmount = inputCapital + inputInterest + finesValue;
      const nextPaid = Number(paidAmount.toFixed(2));
      updatePayload.paid_amount = nextPaid;

      // 只要本期存在已还金额，则标记为手动收款并记录操作人
      if (currentSchedule.operator_admin_name == null) {
        updatePayload.collected_by_type = 'manual';
      }
      if (operatorAdminId) {
        updatePayload.operator_admin_id = operatorAdminId;
        updatePayload.operator_admin_name = operatorName;
      }
      let derivedStatus: RepaymentScheduleStatus = currentSchedule.status;
      if (inputCapital >= baseCapital && inputInterest >= baseInterest) {
        derivedStatus = 'paid';
      } else if (paidAmount >= 1) {
        derivedStatus = 'active';
      } else {
        derivedStatus = 'pending';
      }
      updatePayload.status = derivedStatus;
      updatePayload.paid_at = new Date();
      // 2. 更新还款计划
      const updatedSchedule = await tx.repaymentSchedule.update({
        where: { id: data.id },
        data: updatePayload,
      });

      // 3. 同步对应的还款记录（保持一条记录，与本期还款计划金额一致）
      const loanId = currentSchedule.loan_id;

      // 重新计算 receiving_amount、paid_capital、paid_interest
      // 计算 repaid_periods：状态为 paid 的计划数量
      const paidSchedules = await tx.repaymentSchedule.findMany({
        where: {
          loan_id: loanId,
          status: 'paid',
        },
      });
      const repaidPeriods = paidSchedules.length;

      // 查询所有还款计划，汇总 paid_capital 和 paid_interest
      const allSchedules = await tx.repaymentSchedule.findMany({
        where: {
          loan_id: loanId,
        },
        select: {
          paid_capital: true,
          paid_interest: true,
          fines: true,
        },
      });

      // 汇总所有还款计划的 paid_capital 和 paid_interest
      const totalPaidCapital = allSchedules.reduce(
        (sum, schedule) => sum + Number(schedule.paid_capital || 0),
        0,
      );
      const totalPaidInterest = allSchedules.reduce(
        (sum, schedule) => sum + Number(schedule.paid_interest || 0),
        0,
      );
      const totalFines = allSchedules.reduce(
        (sum, schedule) => sum + Number(schedule.fines || 0),
        0,
      );

      const loan = await tx.loanAccount.findUnique({
        where: { id: loanId },
        select: {
          user_id: true,
          early_settlement_capital: true,
          total_periods: true,
        },
      });

      const earlySettlementCapital = Number(
        loan?.early_settlement_capital || 0,
      );

      // 按照新规则重新计算
      // paid_capital = 所有还款计划的 paid_capital 总和 + early_settlement_capital
      const calculatedPaidCapital = totalPaidCapital + earlySettlementCapital;
      // paid_interest = 所有还款计划的 paid_interest 总和
      const calculatedPaidInterest = totalPaidInterest;
      // receiving_amount = paid_capital + paid_interest + totalFines
      const calculatedReceivingAmount =
        calculatedPaidCapital + calculatedPaidInterest + totalFines;

      // 更新 LoanAccount，同时保存上次编辑的输入值
      // 保存前端传入的原始值，供下次编辑时使用
      const inputFines = data.fines !== undefined ? Number(data.fines) : null;
      const updateLoanData: any = {
        receiving_amount: calculatedReceivingAmount,
        paid_capital: calculatedPaidCapital,
        paid_interest: calculatedPaidInterest,
        repaid_periods: repaidPeriods,
        total_fines: totalFines,
        // 保存上次编辑的输入值（前端传入的原始值），供下次编辑时使用
        last_edit_pay_capital: inputCapital > 0 ? inputCapital : null,
        last_edit_pay_interest: inputInterest > 0 ? inputInterest : null,
        last_edit_fines:
          inputFines !== null && inputFines > 0 ? inputFines : null,
      };

      if (repaidPeriods === loan?.total_periods) {
        updateLoanData.status = 'settled';
      }

      // 检查当前还款计划的 due_start_date 是否小于当天
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const scheduleDate = new Date(currentSchedule.due_start_date);
      scheduleDate.setHours(0, 0, 0, 0);

      // 计算该 loanAccount 关联的所有 RepaymentSchedule.status = 'overdue' 的数量
      const overdueSchedules = await tx.repaymentSchedule.findMany({
        where: {
          loan_id: loanId,
          status: 'overdue',
        },
      });
      updateLoanData.overdue_count = overdueSchedules.length;

      await tx.loanAccount.update({
        where: { id: loanId },
        data: updateLoanData,
      });

      return updatedSchedule;
    });
  }

  async create(loanId: string): Promise<RepaymentSchedule> {
    return await this.prisma.$transaction(async (tx) => {
      // 1. 查询该贷款账户的所有还款计划，按 period 降序排列获取最后一期
      const allSchedules = await tx.repaymentSchedule.findMany({
        where: {
          loan_id: loanId,
        },
        orderBy: {
          period: 'desc',
        },
        take: 1,
      });

      if (allSchedules.length === 0) {
        throw new NotFoundException('该贷款账户没有还款计划，无法添加新期数');
      }

      const lastSchedule = allSchedules[0];

      // 2. 获取贷款账户信息，用于更新 total_periods
      const loanAccount = await tx.loanAccount.findUnique({
        where: { id: loanId },
        select: {
          total_periods: true,
        },
      });

      if (!loanAccount) {
        throw new NotFoundException('贷款账户不存在');
      }

      // 3. 计算新期数的 period 和 due_start_date
      const newPeriod = lastSchedule.period + 1;
      const lastDate = new Date(lastSchedule.due_start_date);
      const newDate = new Date(
        Date.UTC(
          lastDate.getUTCFullYear(),
          lastDate.getUTCMonth(),
          lastDate.getUTCDate() + 1,
        ),
      );

      // 4. 从最后一期复制字段
      const toNumber = (value?: any) =>
        value !== null && value !== undefined ? Number(value) : 0;

      const capital = toNumber(lastSchedule.capital);
      const interest = toNumber(lastSchedule.interest);
      const dueAmount = capital + interest;

      // 5. 创建新还款计划
      const newSchedule = await tx.repaymentSchedule.create({
        data: {
          loan_id: loanId,
          period: newPeriod,
          due_start_date: newDate,
          due_amount: dueAmount,
          capital: capital,
          interest: interest,
          paid_capital: 0,
          paid_interest: 0,
          fines: 0,
          status: 'pending' as RepaymentScheduleStatus,
          paid_amount: 0,
        },
      });

      // 6. 更新 LoanAccount 的 total_periods
      await tx.loanAccount.update({
        where: { id: loanId },
        data: {
          total_periods: loanAccount.total_periods + 1,
        },
      });

      return newSchedule;
    });
  }

  async delete(data: RepaymentSchedule): Promise<RepaymentSchedule> {
    return this.prisma.repaymentSchedule.delete({
      where: { id: data.id },
    });
  }

  async findByStatusToday(
    status: RepaymentScheduleStatus,
    adminId?: number,
  ): Promise<RepaymentSchedule[]> {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 构建基础查询条件
    let whereClause: any = {};

    // 如果查询逾期记录，使用和统计逻辑一致的查询方式
    if (status === 'overdue') {
      // 逾期：周期是一天，所以due_start_date + 1天 < 今天，即due_start_date < 昨天
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      whereClause.due_start_date = { lt: yesterdayStart };

      // 如果有adminId，需要过滤该collector负责的loan accounts
      if (adminId) {
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
        if (loanAccountIds.length > 0) {
          whereClause.loan_id = { in: loanAccountIds };
        } else {
          // 如果没有关联的loan accounts，返回空数组
          return [];
        }
      }
    } else {
      // 其他状态：使用原来的逻辑（due_start_date在当天）
      whereClause.status = status;
      whereClause.due_start_date = {
        gte: today,
        lt: tomorrow,
      };

      // 如果有adminId，需要过滤该collector负责的loan accounts
      if (adminId) {
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
        if (loanAccountIds.length > 0) {
          whereClause.loan_id = { in: loanAccountIds };
        } else {
          // 如果没有关联的loan accounts，返回空数组
          return [];
        }
      }
    }

    // 查询所有符合条件的记录
    const schedules = await this.prisma.repaymentSchedule.findMany({
      where: whereClause,
      include: {
        loan_account: {
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
        },
      },
      orderBy: {
        due_start_date: 'asc',
      },
    });

    // 如果是逾期记录，需要在内存中过滤出未完全支付的记录
    if (status === 'overdue') {
      return schedules.filter((schedule) => {
        const dueAmount = Number(schedule.due_amount || 0);
        const paidAmount = Number(schedule.paid_amount || 0);
        return paidAmount < dueAmount;
      });
    }

    return schedules;
  }

  toResponse(schedule: any): RepaymentScheduleResponseDto {
    return {
      id: schedule.id,
      loan_id: schedule.loan_id,
      period: schedule.period,
      due_start_date: schedule.due_start_date,
      due_amount: Number(schedule.due_amount),
      capital: schedule.capital ? Number(schedule.capital) : undefined,
      interest: schedule.interest ? Number(schedule.interest) : undefined,
      remaining_capital:
        schedule.remaining_capital !== null &&
        schedule.remaining_capital !== undefined
          ? Number(schedule.remaining_capital)
          : undefined,
      remaining_interest:
        schedule.remaining_interest !== null &&
        schedule.remaining_interest !== undefined
          ? Number(schedule.remaining_interest)
          : undefined,
      fines: schedule.fines ? Number(schedule.fines) : undefined,
      status: schedule.status,
      paid_amount: schedule.paid_amount
        ? Number(schedule.paid_amount)
        : undefined,
      paid_at: schedule.paid_at ? schedule.paid_at : undefined,
      // 贷款账户信息
      loan_account: schedule.loan_account
        ? {
            id: schedule.loan_account.id,
            user_id: schedule.loan_account.user_id,
            loan_amount: Number(schedule.loan_account.loan_amount),
            capital: Number(schedule.loan_account.capital),
            interest: Number(schedule.loan_account.interest),
            due_start_date: schedule.loan_account.due_start_date,
            due_end_date: schedule.loan_account.due_end_date,
            status: schedule.loan_account.status,
            handling_fee: Number(schedule.loan_account.handling_fee),
            total_periods: schedule.loan_account.total_periods,
            repaid_periods: schedule.loan_account.repaid_periods,
            daily_repayment: Number(schedule.loan_account.daily_repayment),
            risk_controller:
              schedule.loan_account.risk_controller?.username || '',
            collector: schedule.loan_account.collector?.username || '',
            payee: schedule.loan_account.payee?.username || '',
            lender: schedule.loan_account.lender?.username || '',
            // 用户信息
            user: schedule.loan_account.user
              ? {
                  id: schedule.loan_account.user.id,
                  username: schedule.loan_account.user.username,
                  phone: schedule.loan_account.user.phone,
                  address: schedule.loan_account.user.address,
                  lv: schedule.loan_account.user.lv,
                  overtime: schedule.loan_account.user.overtime,
                  overdue_time: schedule.loan_account.user.overdue_time,
                  is_high_risk: schedule.loan_account.user.is_high_risk,
                }
              : undefined,
          }
        : undefined,
    };
  }
}
