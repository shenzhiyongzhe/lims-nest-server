import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { ManagementRoles } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface AuthenticatedRequest extends Request {
  user: { id: number };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('用户未认证');
    }

    // 获取用户角色
    const admin = (await this.prisma.admin.findUnique({
      where: { id: user.id },
      select: { role: true },
    })) as { role: string } | null;

    if (!admin) {
      throw new ForbiddenException('用户不存在');
    }

    // 从元数据读取允许的角色；如果未指定，则默认放行（仅要求登录）
    const requiredRoles = this.reflector.getAllAndOverride<
      ManagementRoles[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (requiredRoles && requiredRoles.length > 0) {
      if (!requiredRoles.includes(admin.role as ManagementRoles)) {
        throw new ForbiddenException('权限不足');
      }
    }

    return true;
  }
}
