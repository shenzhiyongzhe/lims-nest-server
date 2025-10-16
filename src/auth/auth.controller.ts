import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('verify')
  async verify(@CurrentUser() user?: { id: number }): Promise<{
    message: string;
    valid: boolean;
    data: any;
    client_id?: string;
  }> {
    // 如果没有用户，说明是非管理员用户
    if (!user) {
      return {
        message: '非管理员用户',
        valid: false,
        data: null,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const admin = await this.prisma.admin.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        username: true,
        phone: true,
        role: true,
      },
    });

    if (!admin) {
      return {
        message: '用户不存在',
        valid: false,
        data: null,
      };
    }

    // 生成客户端ID（如果是管理员的话）
    if (admin.role === '管理员') {
      const clientId = this.generateClientId(admin.id);

      return {
        message: '验证成功',
        valid: true,
        data: admin,
        client_id: clientId,
      };
    }

    return {
      message: '验证成功',
      valid: true,
      data: admin,
    };
  }

  /**
   * 生成唯一的客户端ID
   * 管理员的客户端ID基于管理员ID固定不变
   */
  private generateClientId(userId?: number): string {
    if (userId) {
      // 管理员的客户端ID基于管理员ID固定
      return `admin_client_${userId}`;
    }
    // 普通用户的客户端ID随机生成
    return `user_client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
