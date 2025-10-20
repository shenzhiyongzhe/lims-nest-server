import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export enum VisitorType {
  admin = 'admin',
  user = 'user',
}

export enum VisitorAction {
  login = 'login',
  page_view = 'page_view',
  submit_order = 'submit_order',
}

export class LogVisitDto {
  @IsEnum(VisitorType)
  visitor_type: VisitorType;

  @IsInt()
  visitor_id: number;

  @IsEnum(VisitorAction)
  action_type: VisitorAction;

  @IsOptional()
  @IsString()
  page_url?: string;

  @IsOptional()
  @IsString()
  ip_address?: string;

  @IsOptional()
  @IsString()
  user_agent?: string;
}
