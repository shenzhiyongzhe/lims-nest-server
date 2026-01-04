import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateRiskControllerAssetDto {
  @IsNumber()
  @IsOptional()
  @Min(0)
  reduced_amount?: number;
}
