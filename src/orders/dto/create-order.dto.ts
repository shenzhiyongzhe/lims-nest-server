import { PaymentMethod } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  IsDateString,
} from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @IsOptional()
  @Length(1, 64)
  id?: string;

  @IsNumber()
  @IsPositive()
  customer_id: number;

  @IsString()
  loan_id: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsNumber()
  @IsPositive()
  payment_periods: number;

  @IsString()
  @IsEnum(PaymentMethod)
  payment_method: PaymentMethod;

  @IsString()
  @IsOptional()
  remark?: string;

  @IsNumber()
  @IsOptional()
  payee_id?: number;

  @IsDateString()
  @IsOptional()
  expires_at?: Date;
}
