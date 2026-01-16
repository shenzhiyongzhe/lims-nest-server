import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { AuthJwtService } from './jwt.service';
import { PrismaService } from '../../prisma/prisma.service';

interface AuthenticatedRequest extends Request {
  user: { id: number; role: string };
  clientId?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authJwtService: AuthJwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    // 优先使用JWT token验证
    const accessToken = request.cookies?.access_token as string | undefined;
    const refreshToken = request.cookies?.refresh_token as string | undefined;

    if (accessToken) {
      // 验证Access Token
      const payload = this.authJwtService.verifyAccessToken(accessToken);

      if (payload) {
        // Token有效，检查是否即将过期（滑动过期机制）
        if (this.authJwtService.isTokenExpiringSoon(accessToken)) {
          // Token即将过期，尝试自动刷新
          await this.attemptTokenRefresh(refreshToken, response, payload);
        }

        // 从数据库验证用户和token版本
        const admin = await this.prisma.admin.findUnique({
          where: { id: payload.id },
          select: { id: true, username: true, role: true, token_version: true },
        });

        if (!admin) {
          throw new UnauthorizedException('用户不存在');
        }

        request.user = { id: admin.id, role: admin.role };
        return true;
      } else if (refreshToken) {
        // Access Token无效，尝试使用Refresh Token刷新
        const refreshed = await this.attemptTokenRefresh(
          refreshToken,
          response,
        );
        if (refreshed) {
          const refreshPayload =
            this.authJwtService.verifyRefreshToken(refreshToken);
          if (refreshPayload) {
            const admin = await this.prisma.admin.findUnique({
              where: { id: refreshPayload.id },
              select: { id: true, username: true, role: true },
            });

            if (admin) {
              request.user = { id: admin.id, role: admin.role };
              return true;
            }
          }
        }
      }
    }
    throw new UnauthorizedException('未登录或token已过期');
  }

  // 尝试刷新token
  private async attemptTokenRefresh(
    refreshToken: string | undefined,
    response: Response,
    currentPayload?: { id: number; username: string; role: string },
  ): Promise<boolean> {
    if (!refreshToken) {
      return false;
    }

    const payload = this.authJwtService.verifyRefreshToken(refreshToken);
    if (!payload) {
      return false;
    }

    // 从数据库验证token版本
    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.id },
      select: { id: true, username: true, role: true, token_version: true },
    });

    if (!admin || admin.token_version !== payload.tokenVersion) {
      return false;
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

    response.cookie('access_token', newAccessToken, cookieOptions);
    response.cookie('refresh_token', newRefreshToken, refreshCookieOptions);

    return true;
  }
}
