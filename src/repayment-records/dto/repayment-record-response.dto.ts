import { PaymentMethod } from '@prisma/client';

export class RepaymentRecordResponseDto {
  id: number;
  loan_id: string;
  user_id: number;
  paid_amount: number;
  paid_at: Date;
  payment_method: PaymentMethod;
  payee_id: number;
  payee_name?: string;
  remark?: string;
  order_id: string;
  // 用户信息
  user_name?: string;
  user_address?: string;
  // 贷款账户信息
  repaid_periods?: number;
  total_periods?: number;
}
