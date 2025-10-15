import { RepaymentScheduleStatus, LoanAccountStatus } from '@prisma/client';

export class UserInfo {
  id: number;
  username: string;
  phone: string;
  address: string;
  lv: string;
  overtime: number;
  overdue_time: number;
  is_high_risk: boolean;
}

export class LoanAccountInfo {
  id: string;
  user_id: number;
  loan_amount: number;
  capital: number;
  interest: number;
  due_start_date: Date;
  due_end_date: Date;
  status: LoanAccountStatus;
  handling_fee: number;
  total_periods: number;
  repaid_periods: number;
  daily_repayment: number;
  risk_controller: string;
  collector: string;
  payee: string;
  lender: string;
  user?: UserInfo;
}

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
  loan_account?: LoanAccountInfo;
}
