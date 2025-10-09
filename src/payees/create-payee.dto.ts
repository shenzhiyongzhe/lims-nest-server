import {
  IsDateString,
  IsNumber,
  IsString,
  IsOptional,
  IsPositive,
} from 'class-validator';

export class CreatePayeeDto {
  @IsNumber()
  @IsPositive()
  admin_id: number;

  @IsString()
  username: string;

  @IsString()
  address: string;

  @IsNumber()
  @IsPositive()
  payment_limit: number;

  @IsNumber()
  qrcode_number: number;

  @IsDateString()
  @IsOptional()
  createdAt: string;

  @IsDateString()
  @IsOptional()
  updatedAt?: string;
}
