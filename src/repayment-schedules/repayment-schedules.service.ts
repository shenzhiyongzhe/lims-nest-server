import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RepaymentSchedule, RepaymentScheduleStatus } from '@prisma/client';
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

  async update(data: RepaymentSchedule): Promise<RepaymentSchedule> {
    return this.prisma.repaymentSchedule.update({
      where: { id: data.id },
      data,
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
