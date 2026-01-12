import { PaymentMethod } from '@prisma/client';

export class RepaymentRecordResponseDto {
  id: number;
  loan_id: string;
  user_id: number;
  paid_amount: number;
  paid_amount_decimal?: number;
  paid_at: Date;
  payment_method: PaymentMethod;
  actual_collector_id?: number;
  actual_collector_name?: string;
  remark?: string;
  order_id: string;
  // 用户信息
  user_name?: string;
  user_address?: string;
  // 贷款账户信息
  repaid_periods?: number;
  total_periods?: number;
}
