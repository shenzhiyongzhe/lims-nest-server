import { RepaymentScheduleStatus } from '@prisma/client';

export class RepaymentScheduleResponseDto {
  id: number;
  loan_id: string;
  period: number;
  due_start_date: Date;
  due_end_date: Date;
  due_amount: number;
  capital?: number;
  interest?: number;
  status: RepaymentScheduleStatus;
  paid_amount?: number;
  paid_at?: Date;
}
