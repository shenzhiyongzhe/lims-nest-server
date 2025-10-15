import { IsString, IsNumber, IsNotEmpty } from 'class-validator';

export class CreateLoanAccountRoleDto {
  @IsNotEmpty()
  @IsString()
  loan_account_id: string;

  @IsNotEmpty()
  @IsNumber()
  admin_id: number;

  @IsNotEmpty()
  @IsString()
  role_type: string;
}
