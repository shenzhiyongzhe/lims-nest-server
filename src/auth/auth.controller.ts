import {
  Controller,
  Get,
  Post,
  UseGuards,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ResponseHelper } from 'src/common/response-helper';
import { ApiResponseDto } from 'src/common/dto/api-response.dto';
import { AuthJwtService } from './jwt.service';
import type { Request, Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authJwtService: AuthJwtService,
  ) {}

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

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponseDto> {
    const refreshToken = req.cookies?.refresh_token;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token不存在');
    }

    // 验证refresh token
    const payload = this.authJwtService.verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new UnauthorizedException('Refresh token无效或已过期');
    }

    // 从数据库验证token版本（防止token被盗用后继续使用）
    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.id },
      select: { id: true, username: true, role: true, token_version: true },
    });

    if (!admin) {
      throw new UnauthorizedException('用户不存在');
    }

    // 检查token版本是否匹配
    if (payload.tokenVersion !== admin.token_version) {
      throw new UnauthorizedException('Token已失效，请重新登录');
    }

    // 生成新的tokens
    const newAccessToken = this.authJwtService.generateAccessToken({
      id: admin.id,
      username: admin.username,
      role: admin.role,
    });

    const newRefreshToken = this.authJwtService.generateRefreshToken({
      id: admin.id,
      username: admin.username,
      role: admin.role,
      tokenVersion: admin.token_version,
    });

    // 更新cookies（滑动过期）
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? ('strict' as const) : ('lax' as const),
      path: '/',
      maxAge: 15 * 60 * 1000, // Access Token: 15分钟
    };

    const refreshCookieOptions = {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // Refresh Token: 7天（滑动过期）
    };

    res.cookie('access_token', newAccessToken, cookieOptions);
    res.cookie('refresh_token', newRefreshToken, refreshCookieOptions);

    return ResponseHelper.success(
      { message: 'Token刷新成功' },
      'Token刷新成功',
    );
  }
}
