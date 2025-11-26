import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsEnum,
  Min,
  Max,
  IsPositive,
} from 'class-validator';
import { LoanAccountStatus } from '@prisma/client';

export class UpdateLoanAccountDto {
  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Min(100)
  @Max(1000000)
  loan_amount?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Max(1000000)
  to_hand_ratio?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  capital?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  interest?: number;

  @IsDateString()
  @IsOptional()
  due_start_date?: string;

  @IsDateString()
  @IsOptional()
  due_end_date?: string;

  @IsEnum(LoanAccountStatus)
  @IsOptional()
  status?: LoanAccountStatus;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  handling_fee?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Min(1)
  @Max(365)
  total_periods?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  repaid_periods?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  daily_repayment?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  risk_controller_id?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  collector_id?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  payee_id?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  lender_id?: number;

  @IsNumber()
  @IsOptional()
  receiving_amount?: number;

  @IsNumber()
  @IsOptional()
  company_cost?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Min(1)
  apply_times?: number;
}

