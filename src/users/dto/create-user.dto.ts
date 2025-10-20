import {
  IsString,
  Length,
  Matches,
  IsBoolean,
  IsPositive,
  IsNumber,
  IsOptional,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @Length(1, 10)
  username: string;

  @IsOptional()
  @IsString()
  @Length(6, 32)
  password: string;

  @IsOptional()
  @IsString()
  @Length(4, 32)
  lv: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/)
  phone: string;

  @IsString()
  @Length(1, 100)
  address: string;

  @IsOptional()
  @IsNumber()
  overtime: number;

  @IsOptional()
  @IsNumber()
  overdue_time: number;

  @IsOptional()
  @IsBoolean()
  is_high_risk: boolean;
}
