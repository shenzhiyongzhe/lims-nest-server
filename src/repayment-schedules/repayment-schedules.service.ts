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
          due_end_date: true,
          paid_amount: true,
        },
      });

      if (!currentSchedule) {
        throw new NotFoundException('还款计划不存在');
      }

      const toNumber = (value?: any) =>
        value !== null && value !== undefined ? Number(value) : 0;

      const payCapital = Math.max(0, Number(data.pay_capital) || 0);
      const payInterest = Math.max(0, Number(data.pay_interest) || 0);

      const baseCapital = toNumber(currentSchedule.capital);
      const baseInterest = toNumber(currentSchedule.interest);

      const prevPaidCapital = toNumber(currentSchedule.paid_capital);
      const prevPaidInterest = toNumber(currentSchedule.paid_interest);

      const newPaidCapital = Math.min(
        baseCapital,
        Math.max(0, prevPaidCapital + payCapital),
      );
      const newPaidInterest = Math.min(
        baseInterest,
        Math.max(0, prevPaidInterest + payInterest),
      );

      const { pay_capital, pay_interest, ...restData } = data;
      const updatePayload: any = {
        ...restData,
        paid_capital: newPaidCapital,
        paid_interest: newPaidInterest,
      };

      // 预先计算是否有新增实付
      const prevPaid = Number(currentSchedule.paid_amount || 0);
      // finesValue 在后续已计算

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

      const paidAmount = newPaidCapital + newPaidInterest + finesValue;
      const nextPaid = Number(paidAmount.toFixed(2));
      updatePayload.paid_amount = nextPaid;

      const incPaidBeforeUpdate = Math.max(0, nextPaid - prevPaid);
      if (incPaidBeforeUpdate > 0) {
        updatePayload.collected_by_type = 'manual';
        if (operatorAdminId) {
          updatePayload.operator_admin_id = operatorAdminId;
          updatePayload.operator_admin_name = operatorName;
        }
      }

      const hasCapitalProgress =
        baseCapital > 0 && newPaidCapital > 0 && newPaidCapital < baseCapital;
      const hasInterestProgress =
        baseInterest > 0 &&
        newPaidInterest > 0 &&
        newPaidInterest < baseInterest;

      let derivedStatus: RepaymentScheduleStatus = currentSchedule.status;
      if (newPaidCapital >= baseCapital && newPaidInterest >= baseInterest) {
        derivedStatus = 'paid';
      } else if (
        hasCapitalProgress ||
        hasInterestProgress ||
        (data.fines !== undefined && data.fines > 0)
      ) {
        derivedStatus = 'active';
      }
      updatePayload.status = derivedStatus;
      updatePayload.paid_at = new Date();
      // 2. 更新还款计划
      const updatedSchedule = await tx.repaymentSchedule.update({
        where: { id: data.id },
        data: updatePayload,
      });

      // 3. 若 paid_amount 有增加，则记录还款记录并同步 LoanAccount
      const loanId = currentSchedule.loan_id;

      // 计算 paid_amount 增量
      // const prevPaid = Number(currentSchedule.paid_amount || 0);
      const currPaid = Number(updatedSchedule.paid_amount || 0);
      const incPaid = Math.max(0, currPaid - prevPaid);

      if (incPaid > 0) {
        // 获取 LoanAccount 与 Payee 信息
        const loan = await tx.loanAccount.findUnique({
          where: { id: loanId },
          select: { user_id: true, payee_id: true },
        });
        let payee = null as null | { id: number };
        if (loan?.payee_id) {
          payee = await tx.payee.findFirst({
            where: { admin_id: loan.payee_id },
            select: { id: true },
          });
        }
        // 获取操作人名称（用于显示）
        let operatorName: string | null = null;
        if (operatorAdminId) {
          const op = await tx.admin.findUnique({
            where: { id: operatorAdminId },
            select: { username: true },
          });
          operatorName = op?.username ?? null;
        }

        // 创建一个完成的订单用于关联还款记录（标记为手动收款）
        const order = await tx.order.create({
          data: {
            customer_id: loan!.user_id,
            loan_id: loanId,
            amount: incPaid,
            payment_periods: 1,
            payment_method: PaymentMethod.wechat_pay,
            remark: '手动更新还款计划自动生成',
            status: OrderStatus.completed,
            payee_id: payee?.id,
            expires_at: new Date(),
            collected_by_type: 'manual',
            processed_by_admin_id: operatorAdminId ?? null,
            processed_by_admin_name: operatorName ?? null,
          },
        });

        // 1. 创建还款记录（参考 orders.service.ts 写法）
        await tx.repaymentRecord.create({
          data: {
            loan_id: loanId,
            user_id: loan!.user_id,
            paid_amount: incPaid,
            paid_at: new Date(),
            payment_method: PaymentMethod.wechat_pay,
            payee_id: payee?.id ?? 0,
            remark: '来源：编辑还款计划',
            order_id: order.id,
            collected_by_type: 'manual',
            operator_admin_id: operatorAdminId ?? null,
            operator_admin_name: operatorName ?? null,
          },
        });
      }

      // 重新计算 receiving_amount：所有还款计划的(已还本金+已还利息+罚金) 之和，并汇总 LoanAccount 的已还本金
      const allSchedules = await tx.repaymentSchedule.findMany({
        where: { loan_id: loanId },
        select: { paid_capital: true, paid_interest: true, fines: true },
      });
      const totalReceiving = allSchedules.reduce(
        (sum, s) =>
          sum +
          Number(s.paid_capital || 0) +
          Number(s.paid_interest || 0) +
          Number(s.fines || 0),
        0,
      );
      const loanPaidCapital = allSchedules.reduce(
        (sum, s) => sum + Number(s.paid_capital || 0),
        0,
      );
      const totalFines = allSchedules.reduce(
        (sum, s) => sum + Number(s.fines || 0),
        0,
      );

      // 计算 repaid_periods：状态为 paid 的计划数量
      const paidSchedules = await tx.repaymentSchedule.findMany({
        where: {
          loan_id: loanId,
          status: 'paid',
        },
      });
      const repaidPeriods = paidSchedules.length;

      // 更新 LoanAccount
      await tx.loanAccount.update({
        where: { id: loanId },
        data: {
          receiving_amount: totalReceiving,
          paid_capital: loanPaidCapital,
          repaid_periods: repaidPeriods,
          total_fines: totalFines,
        },
      });

      return updatedSchedule;
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
    today.setHours(6, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 构建基础查询条件
    let whereClause: any = {};

    // 如果查询逾期记录，使用和统计逻辑一致的查询方式
    if (status === 'overdue') {
      // 逾期：due_end_date < 当前时间 且 未完全支付
      whereClause.due_end_date = { lt: now };

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
      due_end_date: schedule.due_end_date,
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
