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

@Injectable()
export class LoanAccountsService {
  constructor(private readonly prisma: PrismaService) {}

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

  findById(id: string): Promise<LoanAccount | null> {
    return this.prisma.loanAccount.findUnique({
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
  }

  async findGroupedByUser(
    status?: LoanAccountStatus[],
  ): Promise<Array<{ user: User; loanAccounts: LoanAccount[] }>> {
    const where = status && status.length > 0 ? { status: { in: status } } : {};
    const loans = await this.prisma.loanAccount.findMany({
      where,
      include: { user: true },
      orderBy: { user_id: 'asc' },
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
}
