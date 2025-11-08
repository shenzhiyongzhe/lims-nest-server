import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomBytes } from 'crypto';

interface AuthenticatedRequest extends Request {
  user: { id: number; role: string };
  clientId?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    const admin_id = request.cookies?.admin_id as string | undefined;
    const admin_role = request.cookies?.admin_role as string | undefined;
    let client_id = request.cookies?.client_id as string | undefined;

    if (!admin_id || !admin_role) {
      throw new UnauthorizedException('未登录');
    }

    // 如果没有客户端ID，为管理员生成一个新的
    if (!client_id) {
      client_id = randomBytes(16).toString('hex');
      response.cookie('client_id', client_id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30天
      });
    }

    // 将用户信息和客户端ID添加到请求对象中
    request.user = { id: parseInt(admin_id), role: admin_role };
    request.clientId = client_id;
    return true;
  }
}
