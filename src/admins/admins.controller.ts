import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Delete,
  NotFoundException,
  Query,
  Res,
  Param,
  BadRequestException,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminService } from './admins.service';
import { ManagementRoles } from '@prisma/client';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { LoginAttemptService } from '../auth/login-attempt.service';
import { AuthJwtService } from '../auth/jwt.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('admins')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly loginAttemptService: LoginAttemptService,
    private readonly authJwtService: AuthJwtService,
  ) {}

  @Get()
  async findAll(): Promise<ApiResponseDto> {
    const admins = await this.adminService.findAll();
    const data = admins.map((a) => this.adminService.toResponse(a));
    return ResponseHelper.success(data, '获取管理员成功');
  }
  @Get('role')
  async findByRole(@Query('role') role: string): Promise<ApiResponseDto> {
    const admins = await this.adminService.findByRole(role as ManagementRoles);
    if (!admins) {
      throw new NotFoundException('管理员暂未注册');
    }
    const data = admins.map((a) => this.adminService.toResponse(a));
    return ResponseHelper.success(data, '获取管理员成功');
  }

  @Post()
  async create(@Body() body: CreateAdminDto): Promise<ApiResponseDto> {
    const admin = await this.adminService.create(body);
    const data = this.adminService.toResponse(admin);
    return ResponseHelper.success(data, '创建管理员成功');
  }

  @Post('login')
  async login(
    @Body('username') username: string,
    @Body('password') password: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponseDto> {
    if (!username || !password) {
      throw new BadRequestException('用户名或密码不能为空');
    }

    // 检查账户是否被锁定
    const lockStatus = this.loginAttemptService.isLocked(username);
    if (lockStatus.isLocked) {
      const remainingMinutes = Math.ceil(
        (lockStatus.lockedUntil!.getTime() - Date.now()) / 60000,
      );
      throw new UnauthorizedException(
        `账户已被锁定，请${remainingMinutes}分钟后再试`,
      );
    }

    // 查找管理员
    const admin = await this.adminService.login(username);
    if (!admin) {
      // 即使用户不存在，也记录失败（防止用户名枚举攻击）
      this.loginAttemptService.recordFailure(username);
      throw new NotFoundException('管理员暂未注册');
    }
    // 验证密码
    const isPasswordValid = await this.adminService.comparePassword(
      password,
      admin.password,
    );

    if (!isPasswordValid) {
      // 记录登录失败
      const attemptResult = this.loginAttemptService.recordFailure(username);
      await this.adminService.incrementFailedAttempts(admin.id);

      if (attemptResult.isLocked) {
        const remainingMinutes = Math.ceil(
          (attemptResult.lockedUntil!.getTime() - Date.now()) / 60000,
        );
        throw new UnauthorizedException(
          `密码错误，账户已被锁定${remainingMinutes}分钟`,
        );
      }

      throw new UnauthorizedException(
        `密码错误，剩余尝试次数：${attemptResult.remainingAttempts}`,
      );
    }

    // 登录成功，清除失败记录
    this.loginAttemptService.recordSuccess(username);

    // 获取客户端IP
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    await this.adminService.updateLoginInfo(admin.id, clientIp);

    // 生成JWT tokens
    const accessToken = this.authJwtService.generateAccessToken({
      id: admin.id,
      username: admin.username,
      role: admin.role,
    });

    const refreshToken = this.authJwtService.generateRefreshToken({
      id: admin.id,
      username: admin.username,
      role: admin.role,
      tokenVersion: admin.token_version,
    });

    // 设置HttpOnly Cookie（更安全）
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction, // 生产环境启用HTTPS
      sameSite: isProduction ? ('strict' as const) : ('lax' as const),
      path: '/',
      maxAge: 15 * 60 * 1000, // Access Token: 15分钟
    };

    const refreshCookieOptions = {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // Refresh Token: 7天
    };

    res.cookie('access_token', accessToken, cookieOptions);
    res.cookie('refresh_token', refreshToken, refreshCookieOptions);

    const data = this.adminService.toResponse(admin);
    return ResponseHelper.success(data, '登录成功');
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { message: string } {
    // 清除所有认证相关的cookie
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
    return { message: '登出成功' };
  }

  @Get(':id')
  async findById(@Param('id') id: number): Promise<ApiResponseDto> {
    const admin = await this.adminService.findById(id);
    if (!admin) {
      throw new NotFoundException('管理员暂未注册');
    }
    const data = this.adminService.toResponse(admin);
    return ResponseHelper.success(data, '获取管理员成功');
  }
  @Put(':id')
  async update(
    @Param('id') id: number,
    @Body() body: CreateAdminDto,
  ): Promise<ApiResponseDto> {
    const admin = await this.adminService.update(id, body);
    if (!admin) {
      return ResponseHelper.error('管理员暂未注册');
    }
    const data = this.adminService.toResponse(admin);
    return ResponseHelper.success(data, '更新管理员成功');
  }
  @Delete(':id')
  async delete(@Param('id') id: number): Promise<ApiResponseDto> {
    const admin = await this.adminService.delete(id);
    if (!admin) {
      throw new NotFoundException('管理员暂未注册');
    }
    const data = this.adminService.toResponse(admin);
    return ResponseHelper.success(data, '删除管理员成功');
  }

  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: number): Promise<ApiResponseDto> {
    const admin = await this.adminService.resetPassword(id);
    if (!admin) {
      throw new NotFoundException('管理员暂未注册');
    }
    const data = this.adminService.toResponse(admin);
    return ResponseHelper.success(data, '密码已重置为123456');
  }

  @Post('reset-password')
  @UseGuards(AuthGuard)
  async resetMyPassword(@Req() req: Request): Promise<ApiResponseDto> {
    const adminId = (req as any).user?.id;
    if (!adminId) {
      throw new UnauthorizedException('未授权');
    }
    const admin = await this.adminService.resetPassword(adminId);
    if (!admin) {
      throw new NotFoundException('管理员暂未注册');
    }
    const data = this.adminService.toResponse(admin);
    return ResponseHelper.success(data, '密码已重置为123456');
  }

  @Post('emergency-reset-password')
  async emergencyResetPassword(
    @Body('username') username: string,
    @Body('secretKey') secretKey: string,
  ): Promise<ApiResponseDto> {
    // 验证密钥（从环境变量获取，生产环境必须设置）
    const requiredSecretKey =
      process.env.EMERGENCY_RESET_SECRET_KEY || 'EMERGENCY_RESET_2024';
    if (!secretKey || secretKey !== requiredSecretKey) {
      throw new UnauthorizedException('密钥错误，无法执行紧急重置');
    }

    if (!username) {
      throw new BadRequestException('用户名不能为空');
    }

    // 查找管理员
    const admin = await this.adminService.login(username);
    if (!admin) {
      throw new NotFoundException('管理员不存在');
    }

    // 重置密码
    const resetAdmin = await this.adminService.resetPassword(admin.id);
    const data = this.adminService.toResponse(resetAdmin);
    return ResponseHelper.success(
      data,
      `管理员 ${username} 的密码已紧急重置为123456，请立即登录并修改密码`,
    );
  }
}
