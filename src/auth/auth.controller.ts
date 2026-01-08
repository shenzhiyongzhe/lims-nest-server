import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ResponseHelper } from 'src/common/response-helper';
import { ApiResponseDto } from 'src/common/dto/api-response.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('verify')
  @UseGuards(AuthGuard)
  async verify(
    @CurrentUser() user: { id: number; role: string } | null,
  ): Promise<ApiResponseDto<any>> {
    if (!user) {
      return ResponseHelper.error('未登录', 401);
    }

    // If role is ADMIN, enrich from DB (keeps existing behavior)
    if (user.role === 'ADMIN') {
      const admin = await this.prisma.admin.findUnique({
        where: { id: user.id },
        select: { id: true, username: true, role: true },
      });
      if (!admin) {
        return ResponseHelper.error('用户不存在', 404);
      }
      return ResponseHelper.success(
        { code: 200, message: '验证成功', valid: true, data: admin },
        '验证成功',
      );
    }
    return ResponseHelper.success(
      { code: 200, message: '验证成功', valid: true, data: user },
      '验证成功',
    );
  }
}
