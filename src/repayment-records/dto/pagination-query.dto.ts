import { IsOptional, IsNumber, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  userId?: number;

  @IsOptional()
  loanId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  payeeId?: number;

  @IsOptional()
  startDate?: string;

  @IsOptional()
  endDate?: string;

  @IsOptional()
  @IsString()
  collector?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  riskControllerId?: number; // 负责人筛选风控人时使用

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  collectorId?: number; // 风控人筛选负责人时使用
}
