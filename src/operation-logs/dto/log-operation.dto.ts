import {
  IsNotEmpty,
  IsString,
  IsInt,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { OperationType } from '@prisma/client';

export class LogOperationDto {
  @IsNotEmpty()
  @IsString()
  entity_type: string;

  @IsNotEmpty()
  @IsString()
  entity_id: string;

  @IsNotEmpty()
  @IsEnum(OperationType)
  operation_type: OperationType;

  @IsNotEmpty()
  @IsInt()
  admin_id: number;

  @IsNotEmpty()
  @IsString()
  admin_username: string;

  @IsOptional()
  @IsString()
  old_data?: string;

  @IsOptional()
  @IsString()
  new_data?: string;

  @IsOptional()
  @IsString()
  ip_address?: string;
}
