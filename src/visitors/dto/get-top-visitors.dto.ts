import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export class GetTopVisitorsDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsEnum(['admin', 'user'])
  visitor_type?: string;

  @IsOptional()
  @IsInt()
  limit?: number;
}
