import { IsDateString } from 'class-validator';

export class CalculateStatisticsDto {
  @IsDateString()
  date: string; // YYYY-MM-DD format
}
