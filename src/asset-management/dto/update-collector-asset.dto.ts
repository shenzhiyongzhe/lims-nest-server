import { IsNumber, IsOptional } from 'class-validator';

export class UpdateCollectorAssetDto {
  @IsNumber()
  @IsOptional()
  reduced_handling_fee?: number;

  @IsNumber()
  @IsOptional()
  reduced_fines?: number;
}
