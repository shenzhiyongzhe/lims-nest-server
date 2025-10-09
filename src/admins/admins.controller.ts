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
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminService } from './admins.service';
import { ManagementRoles } from '@prisma/client';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';
@Controller('admins')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponseDto> {
    if (!username || !password) {
      throw new BadRequestException('用户名或密码不能为空');
    }
    const admin = await this.adminService.login(username);
    if (!admin) {
      throw new NotFoundException('管理员暂未注册');
    }
    if (admin.password !== password) {
      return ResponseHelper.error('密码错误');
    }

    // 设置cookie
    res.cookie('admin', JSON.stringify({ id: admin.id, role: admin.role }), {
      httpOnly: true, // 防止XSS攻击
      // secure: process.env.NODE_ENV === 'production', // 生产环境使用HTTPS
      maxAge: 7 * 24 * 60 * 60 * 1000, // 24小时过期
      sameSite: 'strict', // CSRF保护
    });

    const data = this.adminService.toResponse(admin);
    return ResponseHelper.success(data, '登录成功');
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { message: string } {
    res.clearCookie('admin');
    return { message: '登出成功' };
  }

  @Get('verify')
  async verify(@Res({ passthrough: true }) res: Response): Promise<{
    message: string;
    valid: boolean;
    data?: {
      id: number;
      username: string;
      phone: string;
      role: ManagementRoles;
    };
  }> {
    try {
      const adminId = res.req.cookies?.admin as string;
      if (!adminId) {
        return {
          message: '未登录',
          valid: false,
        };
      }

      if (!adminId) {
        return {
          message: '未登录',
          valid: false,
        };
      }

      const admin = await this.adminService.findById(parseInt(adminId));

      if (!admin) {
        // 清除无效的cookie
        res.clearCookie('admin');
        return {
          message: '用户不存在',
          valid: false,
        };
      }

      return {
        message: '验证成功',
        valid: true,
        data: {
          id: admin.id,
          username: admin.username,
          phone: admin.phone,
          role: admin.role,
        },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      return {
        message: errorMessage || ('验证失败' as string),
        valid: false,
      };
    }
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
}
