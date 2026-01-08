import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class ResponseAdminDto {
  @IsNumber()
  id: number;

  @IsString()
  @Length(1, 10)
  username: string;

  @IsOptional()
  @IsString()
  @Length(6, 32)
  password: string;

  @IsString()
  @Length(1, 16)
  role: string;
}
