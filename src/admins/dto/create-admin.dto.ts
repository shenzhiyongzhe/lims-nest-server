import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateAdminDto {
  @IsString()
  @Length(1, 10)
  username: string;

  @IsString()
  @Length(6, 32)
  @IsOptional()
  password: string;

  @IsString()
  @Length(1, 16)
  role: string;
}
