import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('verify')
  @UseGuards(AuthGuard)
  async verify(@CurrentUser() user: { id: number }): Promise<{
    message: string;
    valid: boolean;
    data: any;
  }> {
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

    return {
      message: '验证成功',
      valid: true,
      data: admin,
    };
  }
}
