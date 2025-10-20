import { IsOptional, IsString, IsDateString } from 'class-validator';

export class GetStatisticsDto {
  @IsOptional()
  @IsString()
  range?: string; // 'last_7_days', 'last_30_days', 'last_90_days', 'custom'

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
