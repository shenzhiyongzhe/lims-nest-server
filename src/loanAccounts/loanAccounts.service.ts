import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LoanAccount, RepaymentStatus } from '@prisma/client';
import { CreateLoanAccountDto } from './dto/create-loanAccount.dto';

@Injectable()
export class LoanAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<LoanAccount[]> {
    return this.prisma.loanAccount.findMany();
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
    startDate.setHours(14, 0, 0, 0);
    endDate.setHours(14, 0, 0, 0);

    // 使用事务：创建贷款记录并批量创建还款计划
    const loan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.loanAccount.create({
        data: {
          user_id: data.user_id,
          loan_amount: data.loan_amount,
          receiving_amount: data.receiving_amount,
          risk_controller: data.risk_controller,
          collector: data.collector,
          payee: data.payee,
          lender: data.lender,
          company_cost: data.company_cost,
          handling_fee: data.handling_fee as number,
          due_start_date: startDate,
          due_end_date: endDate,
          total_periods: Number(total_periods),
          daily_repayment: Number(daily_repayment),
          capital: Number(capital),
          interest: Number(interest),
          status: data.status as RepaymentStatus,
          repaid_periods: 0,
          created_by: createdBy,
        },
      });

      const periods = Number(total_periods) || 0;
      const perAmount = Number(daily_repayment) || created.daily_repayment || 0;

      const rows = Array.from({ length: periods }).map((_, idx) => {
        const d = new Date(created.due_start_date);
        d.setDate(d.getDate() + idx);
        d.setHours(14, 0, 0, 0);
        const end = new Date(d);
        end.setDate(end.getDate() + 1);
        end.setHours(14, 0, 0, 0);
        return {
          loan_id: created.id,
          period: idx + 1,
          due_start_date: d,
          due_end_date: end,
          due_amount: perAmount,
          capital: capital ? Number(capital) : null,
          interest: interest ? Number(interest) : null,
          status: data.status as RepaymentStatus,
        };
      });

      if (rows.length > 0) {
        await tx.repaymentSchedule.createMany({ data: rows });
      }

      return created;
    });

    return loan;
  }

  findById(id: number): Promise<LoanAccount | null> {
    return this.prisma.loanAccount.findUnique({
      where: { id },
      include: {
        user: true,
        repaymentSchedules: true,
      },
    });
  }
}
