import {
  IsString,
  IsInt,
  IsBoolean,
  IsOptional,
  Length,
  Min,
  Max,
} from 'class-validator';

export class CreateEmailConfigDto {
  @IsString()
  @Length(1, 50)
  name: string;

  @IsString()
  @Length(1, 100)
  host: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @IsBoolean()
  secure: boolean;

  @IsString()
  @Length(1, 100)
  user: string;

  @IsString()
  @Length(1, 255)
  pass: string;

  @IsString()
  @IsOptional()
  @Length(1, 100)
  from?: string;

  @IsBoolean()
  @IsOptional()
  is_enabled?: boolean;
}
