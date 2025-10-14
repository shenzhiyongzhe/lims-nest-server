import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RepaymentSchedule } from '@prisma/client';
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

  toResponse(schedule: RepaymentSchedule): RepaymentScheduleResponseDto {
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
    };
  }
}
