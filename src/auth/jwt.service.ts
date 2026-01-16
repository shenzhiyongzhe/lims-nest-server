import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface TokenPayload {
  id: number;
  username: string;
  role: string;
  type: 'access' | 'refresh';
}

@Injectable()
export class AuthJwtService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // 生成Access Token（15分钟有效期）
  generateAccessToken(payload: {
    id: number;
    username: string;
    role: string;
  }): string {
    const tokenPayload: TokenPayload = {
      ...payload,
      type: 'access',
    };
    return this.jwtService.sign(tokenPayload, {
      expiresIn: '15m',
      secret:
        this.configService.get<string>('JWT_SECRET') ||
        'your-secret-key-change-in-production',
    });
  }

  // 生成Refresh Token（7天有效期）
  generateRefreshToken(payload: {
    id: number;
    username: string;
    role: string;
    tokenVersion: number;
  }): string {
    const tokenPayload: TokenPayload = {
      id: payload.id,
      username: payload.username,
      role: payload.role,
      type: 'refresh',
    };
    return this.jwtService.sign(
      { ...tokenPayload, tokenVersion: payload.tokenVersion },
      {
        expiresIn: '7d',
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          'your-refresh-secret-key-change-in-production',
      },
    );
  }

  // 验证Access Token
  verifyAccessToken(token: string): TokenPayload | null {
    try {
      const payload = this.jwtService.verify<TokenPayload>(token, {
        secret:
          this.configService.get<string>('JWT_SECRET') ||
          'your-secret-key-change-in-production',
      });
      if (payload.type !== 'access') {
        return null;
      }
      return payload;
    } catch (error) {
      return null;
    }
  }

  // 验证Refresh Token
  verifyRefreshToken(
    token: string,
  ): (TokenPayload & { tokenVersion: number }) | null {
    try {
      const payload = this.jwtService.verify<
        TokenPayload & { tokenVersion: number }
      >(token, {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          'your-refresh-secret-key-change-in-production',
      });
      if (payload.type !== 'refresh') {
        return null;
      }
      return payload;
    } catch (error) {
      return null;
    }
  }

  // 检查token是否即将过期（剩余时间少于5分钟）
  isTokenExpiringSoon(token: string): boolean {
    try {
      const decoded = this.jwtService.decode(token) as { exp: number } | null;
      if (!decoded || !decoded.exp) {
        return true;
      }
      const expirationTime = decoded.exp * 1000; // 转换为毫秒
      const currentTime = Date.now();
      const timeUntilExpiry = expirationTime - currentTime;
      const fiveMinutes = 5 * 60 * 1000; // 5分钟
      return timeUntilExpiry < fiveMinutes;
    } catch (error) {
      return true;
    }
  }
}
