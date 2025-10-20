import { IsEnum, IsOptional, IsString } from 'class-validator';

export class GetVisitorStatsDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsEnum(['last_7_days', 'last_30_days', 'last_90_days', 'custom'])
  range?: string;
}
