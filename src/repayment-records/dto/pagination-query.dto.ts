import { IsOptional, IsNumber, Min, Max, IsString } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  userId?: number;

  @IsOptional()
  loanId?: string;

  @IsOptional()
  payeeId?: number;

  @IsOptional()
  startDate?: string;

  @IsOptional()
  endDate?: string;

  @IsOptional()
  @IsString()
  collector?: string;
}
