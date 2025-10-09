import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user: { id: number };
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const adminString = request.cookies?.admin as string | undefined;
    const admin = adminString
      ? (JSON.parse(adminString) as { id: number })
      : undefined;
    if (!admin) {
      throw new UnauthorizedException('未登录');
    }
    // 将用户ID添加到请求对象中
    request.user = { id: admin.id };
    return true;
  }
}
