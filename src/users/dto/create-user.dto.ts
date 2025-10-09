import { IsString, Length, Matches } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @Length(1, 10)
  username: string;

  @IsString()
  @Matches(/^\d{11}$/)
  phone: string;

  @IsString()
  @Length(1, 100)
  address: string;

  @IsString()
  @Length(4, 32)
  lv: string;
}
