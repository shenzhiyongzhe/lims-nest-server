import {
  IsString,
  Length,
  Matches,
  IsBoolean,
  IsPositive,
  IsNumber,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @Length(1, 10)
  username: string;

  @IsString()
  @Length(6, 32)
  password: string;

  @IsString()
  @Length(4, 32)
  lv: string;

  @IsString()
  @Matches(/^\d{11}$/)
  phone: string;

  @IsString()
  @Length(1, 100)
  address: string;

  @IsNumber()
  overtime: number;

  @IsNumber()
  overdue_time: number;

  @IsBoolean()
  is_high_risk: boolean;
}
