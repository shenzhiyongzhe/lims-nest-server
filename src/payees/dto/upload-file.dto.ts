import { IsString, IsNotEmpty, IsIn } from 'class-validator';

export class UploadFileDto {
  @IsString()
  @IsNotEmpty()
  qrcode_type: string;
}
