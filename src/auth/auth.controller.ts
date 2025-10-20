import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('verify')
  async verify(
    @CurrentUser() user: { id: number; role: string } | null,
  ): Promise<{
    message: string;
    valid: boolean;
    data: any;
    client_id?: string;
  }> {
    if (!user) {
      return { message: '未登录', valid: false, data: null };
    }

    // If role is 管理员, enrich from DB (keeps existing behavior)
    if (user.role === '管理员') {
      const admin = await this.prisma.admin.findUnique({
        where: { id: user.id },
        select: { id: true, username: true, phone: true, role: true },
      });
      if (!admin) {
        return { message: '用户不存在', valid: false, data: null };
      }
      return {
        message: '验证成功',
        valid: true,
        data: admin,
        client_id: this.generateClientId(admin.id),
      };
    }

    // For non-admin, return minimal unified identity
    return { message: '验证成功', valid: true, data: user };
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
