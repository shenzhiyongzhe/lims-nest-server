import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateCollectorAssetDto {
  @IsNumber()
  @IsOptional()
  @Min(0)
  total_handling_fee?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  total_fines?: number;
}
