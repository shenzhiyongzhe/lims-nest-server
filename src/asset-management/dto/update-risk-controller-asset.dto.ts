import { IsNumber, IsOptional } from 'class-validator';

export class UpdateRiskControllerAssetDto {
  @IsNumber()
  @IsOptional()
  reduced_amount?: number;
}
