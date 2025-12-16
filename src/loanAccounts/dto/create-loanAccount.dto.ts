import {
  IsDateString,
  IsNumber,
  IsString,
  IsOptional,
  IsEnum,
  Min,
  Max,
  Length,
  IsPositive,
} from 'class-validator';
import { RepaymentScheduleStatus } from '@prisma/client';

export class CreateLoanAccountDto {
  @IsNumber()
  @IsPositive()
  user_id: number;

  @IsNumber()
  @IsPositive()
  @Min(100)
  @Max(1000000)
  loan_amount: number;

  @IsNumber()
  @IsPositive()
  @Max(1000000)
  to_hand_ratio: number;

  @IsNumber()
  @IsPositive()
  capital: number;

  @IsNumber()
  @IsPositive()
  interest: number;

  @IsDateString()
  due_start_date: string;

  @IsDateString()
  due_end_date: string;

  @IsEnum(RepaymentScheduleStatus)
  @IsOptional()
  status?: RepaymentScheduleStatus;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  handling_fee?: number;

  @IsNumber()
  @IsPositive()
  @Min(1)
  @Max(365)
  total_periods: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  repaid_periods?: number;

  @IsNumber()
  @IsPositive()
  daily_repayment: number;

  @IsNumber()
  @IsPositive()
  risk_controller_id: number;

  @IsNumber()
  @IsPositive()
  collector_id: number;

  @IsNumber()
  @IsPositive()
  lender_id: number;

  @IsNumber()
  @IsOptional()
  receiving_amount?: number;

  @IsNumber()
  @IsOptional()
  company_cost?: number;

  @IsString()
  @IsOptional()
  remark?: string;
}
