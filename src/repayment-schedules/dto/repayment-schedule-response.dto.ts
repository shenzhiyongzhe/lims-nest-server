import { RepaymentStatus } from '@prisma/client';

export class RepaymentScheduleResponseDto {
  id: number;
  loan_id: number;
  period: number;
  due_start_date: Date;
  due_end_date: Date;
  due_amount: number;
  capital?: number;
  interest?: number;
  status: RepaymentStatus;
  paid_amount?: number;
  paid_at?: Date;
}
