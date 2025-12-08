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
          due_end_date: true,
          paid_amount: true,
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
      if (nextPaid > 0) {
        updatePayload.collected_by_type = 'manual';
        if (operatorAdminId) {
          updatePayload.operator_admin_id = operatorAdminId;
          updatePayload.operator_admin_name = operatorName;
        }
      } else {
        updatePayload.collected_by_type = null;
        updatePayload.operator_admin_id = null;
        updatePayload.operator_admin_name = null;
      }

      let derivedStatus: RepaymentScheduleStatus = currentSchedule.status;
      if (inputCapital >= baseCapital && inputInterest >= baseInterest) {
        derivedStatus = 'paid';
      } else if (paidAmount >= 1) {
        derivedStatus = 'active';
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
      const currPaid = Number(updatedSchedule.paid_amount || 0);

      // 仅当存在已还金额时才需要维护还款记录
      if (currPaid > 0) {
        // 获取 LoanAccount 信息
        const loan = await tx.loanAccount.findUnique({
          where: { id: loanId },
          select: { user_id: true },
        });
        let payee = null as null | { id: number };

        // 获取操作人名称（用于显示）
        let operatorDisplayName: string | null = null;
        if (operatorAdminId) {
          const op = await tx.admin.findUnique({
            where: { id: operatorAdminId },
            select: { username: true },
          });
          operatorDisplayName = op?.username ?? null;
        }

        // 查找是否已有与该还款计划关联的还款记录
        const existingRecord = await tx.repaymentRecord.findFirst({
          where: { repayment_schedule_id: updatedSchedule.id },
        });

        if (existingRecord) {
          // 更新已有订单金额
          if (existingRecord.order_id) {
            await tx.order.update({
              where: { id: existingRecord.order_id },
              data: {
                amount: currPaid,
                remark: '来源：编辑还款计划',
              },
            });
          }

          // 更新已有还款记录为当前本期总额
          await tx.repaymentRecord.update({
            where: { id: existingRecord.id },
            data: {
              paid_amount: currPaid,
              paid_at: new Date(),
              payment_method: PaymentMethod.wechat_pay,
              payee_id: payee?.id ?? existingRecord.payee_id ?? 0,
              remark: '来源：编辑还款计划',
              collected_by_type: 'manual',
              operator_admin_id:
                operatorAdminId ?? existingRecord.operator_admin_id,
              operator_admin_name:
                operatorDisplayName ?? existingRecord.operator_admin_name,
              paid_capital: inputCapital > 0 ? inputCapital : null,
              paid_interest: inputInterest > 0 ? inputInterest : null,
              paid_fines: finesValue > 0 ? finesValue : null,
            },
          });
        } else {
          // 创建一个完成的订单用于关联新的还款记录（标记为手动收款）
          const order = await tx.order.create({
            data: {
              customer_id: loan!.user_id,
              loan_id: loanId,
              amount: currPaid,
              payment_periods: 1,
              payment_method: PaymentMethod.wechat_pay,
              remark: '手动更新还款计划自动生成',
              status: OrderStatus.completed,
              payee_id: payee?.id,
              expires_at: new Date(),
              collected_by_type: 'manual',
              processed_by_admin_id: operatorAdminId ?? null,
              processed_by_admin_name: operatorDisplayName ?? null,
            },
          });

          // 创建新还款记录（总额视为本期所有已还）
          await tx.repaymentRecord.create({
            data: {
              loan_id: loanId,
              user_id: loan!.user_id,
              paid_amount: currPaid,
              paid_at: new Date(),
              payment_method: PaymentMethod.wechat_pay,
              payee_id: payee?.id ?? 0,
              remark: '来源：编辑还款计划',
              order_id: order.id,
              collected_by_type: 'manual',
              operator_admin_id: operatorAdminId ?? null,
              operator_admin_name: operatorDisplayName ?? null,
              paid_capital: inputCapital > 0 ? inputCapital : null,
              paid_interest: inputInterest > 0 ? inputInterest : null,
              paid_fines: finesValue > 0 ? finesValue : null,
              repayment_schedule_id: updatedSchedule.id,
            },
          });
        }
      } else {
        // 如果本期已还金额被清零，尝试删除与本计划唯一关联的还款记录及其订单
        const records = await tx.repaymentRecord.findMany({
          where: { repayment_schedule_id: updatedSchedule.id },
          select: { id: true, order_id: true },
        });

        if (records.length > 0) {
          // 参考 resetSchedule 逻辑，删除与该计划相关的还款记录与订单
          const orderIds = [...new Set(records.map((r) => r.order_id))];

          await tx.repaymentRecord.deleteMany({
            where: { repayment_schedule_id: updatedSchedule.id },
          });

          if (orderIds.length > 0) {
            const remainingRecords = await tx.repaymentRecord.findMany({
              where: {
                order_id: { in: orderIds },
              },
              select: {
                order_id: true,
              },
              distinct: ['order_id'],
            });

            const remainingOrderIds = new Set(
              remainingRecords.map((r) => r.order_id),
            );

            const ordersToDelete = orderIds.filter(
              (id) => !remainingOrderIds.has(id),
            );

            if (ordersToDelete.length > 0) {
              await tx.order.deleteMany({
                where: {
                  id: { in: ordersToDelete },
                },
              });
            }
          }
        }
      }

      // 重新计算 receiving_amount：所有还款计划的(已还本金+已还利息+罚金) 之和，并汇总 LoanAccount 的已还本金和已还利息
      // 计算 repaid_periods：状态为 paid 的计划数量
      const paidSchedules = await tx.repaymentSchedule.findMany({
        where: {
          loan_id: loanId,
          status: 'paid',
        },
      });
      const repaidPeriods = paidSchedules.length;
      const loan = await tx.loanAccount.findUnique({
        where: { id: loanId },
        select: {
          user_id: true,
          receiving_amount: true,
          paid_capital: true,
          paid_interest: true,
          total_fines: true,
        },
      });
      // 更新 LoanAccount，同时保存上次编辑的输入值
      // 保存前端传入的原始值，供下次编辑时使用
      const inputFines = data.fines !== undefined ? Number(data.fines) : null;
      await tx.loanAccount.update({
        where: { id: loanId },
        data: {
          receiving_amount: Number(loan?.receiving_amount || 0) + currPaid,
          paid_capital: Number(loan?.paid_capital || 0) + inputCapital,
          paid_interest: Number(loan?.paid_interest || 0) + inputInterest,
          repaid_periods: repaidPeriods,
          total_fines: Number(loan?.total_fines || 0) + finesValue,
          // 保存上次编辑的输入值（前端传入的原始值），供下次编辑时使用
          last_edit_pay_capital: inputCapital > 0 ? inputCapital : null,
          last_edit_pay_interest: inputInterest > 0 ? inputInterest : null,
          last_edit_fines:
            inputFines !== null && inputFines > 0 ? inputFines : null,
        },
      });

      return updatedSchedule;
    });
  }

  /**
   * 恢复还款计划到初始状态
   * 删除相关的订单和还款记录，清零已还本金、已还利息、罚金，恢复到待还款状态
   */
  async resetSchedule(scheduleId: number): Promise<RepaymentSchedule> {
    return await this.prisma.$transaction(async (tx) => {
      // 1. 获取还款计划信息
      const schedule = await tx.repaymentSchedule.findUnique({
        where: { id: scheduleId },
        select: {
          id: true,
          loan_id: true,
          capital: true,
          interest: true,
        },
      });

      if (!schedule) {
        throw new NotFoundException('还款计划不存在');
      }

      // 2. 查找所有关联的还款记录
      const repaymentRecords = await tx.repaymentRecord.findMany({
        where: {
          repayment_schedule_id: scheduleId,
        },
        select: {
          id: true,
          order_id: true,
        },
      });

      // 3. 收集所有关联的订单ID（去重）
      const orderIds = [...new Set(repaymentRecords.map((r) => r.order_id))];

      // 4. 删除还款记录
      if (repaymentRecords.length > 0) {
        await tx.repaymentRecord.deleteMany({
          where: {
            repayment_schedule_id: scheduleId,
          },
        });
      }

      // 5. 删除关联的订单（只删除没有其他还款记录关联的订单）
      if (orderIds.length > 0) {
        // 查找这些订单是否还有其他还款记录关联
        const remainingRecords = await tx.repaymentRecord.findMany({
          where: {
            order_id: { in: orderIds },
          },
          select: {
            order_id: true,
          },
          distinct: ['order_id'],
        });

        const remainingOrderIds = new Set(
          remainingRecords.map((r) => r.order_id),
        );

        // 只删除没有其他还款记录关联的订单
        const ordersToDelete = orderIds.filter(
          (id) => !remainingOrderIds.has(id),
        );

        if (ordersToDelete.length > 0) {
          await tx.order.deleteMany({
            where: {
              id: { in: ordersToDelete },
            },
          });
        }
      }

      // 6. 恢复还款计划到初始状态
      const resetSchedule = await tx.repaymentSchedule.update({
        where: { id: scheduleId },
        data: {
          paid_capital: 0,
          paid_interest: 0,
          fines: 0,
          paid_amount: 0,
          status: 'pending',
          paid_at: null,
          collected_by_type: null,
          operator_admin_id: null,
          operator_admin_name: null,
        },
      });

      // 7. 重新计算 LoanAccount 的统计数据
      const allSchedules = await tx.repaymentSchedule.findMany({
        where: { loan_id: schedule.loan_id },
        select: {
          paid_capital: true,
          paid_interest: true,
          fines: true,
          status: true,
        },
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
      const loanPaidInterest = allSchedules.reduce(
        (sum, s) => sum + Number(s.paid_interest || 0),
        0,
      );
      const totalFines = allSchedules.reduce(
        (sum, s) => sum + Number(s.fines || 0),
        0,
      );
      const repaidPeriods = allSchedules.filter(
        (s) => s.status === 'paid',
      ).length;

      // 8. 更新 LoanAccount
      await tx.loanAccount.update({
        where: { id: schedule.loan_id },
        data: {
          receiving_amount: totalReceiving,
          paid_capital: loanPaidCapital,
          paid_interest: loanPaidInterest,
          repaid_periods: repaidPeriods,
          total_fines: totalFines,
        },
      });

      return resetSchedule;
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
      // 逾期：due_end_date < 今天的开始时间 且 未完全支付
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      whereClause.due_end_date = { lt: todayStart };

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
