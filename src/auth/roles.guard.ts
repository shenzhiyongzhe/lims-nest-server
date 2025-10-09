import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

interface AuthenticatedRequest extends Request {
  user: { id: number };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('用户未认证');
    }

    // 获取用户角色
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const admin = (await this.prisma.admin.findUnique({
      where: { id: user.id },
      select: { role: true },
    })) as { role: string } | null;

    if (!admin) {
      throw new ForbiddenException('用户不存在');
    }

    // 检查角色权限
    const allowedRoles = ['管理员', '负责人', '风控人'];
    if (!allowedRoles.includes(admin.role)) {
      throw new ForbiddenException('权限不足');
    }

    return true;
  }
}
