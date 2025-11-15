import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { ResponseHelper } from 'src/common/response-helper';
import { ApiResponseDto } from 'src/common/dto/api-response.dto';
import { AuthGuard } from 'src/auth/auth.guard';
import { RolesGuard } from 'src/auth/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { ManagementRoles } from '@prisma/client';
import { CurrentUser } from 'src/auth/current-user.decorator';

@UseGuards(AuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: { id: number },
  ): Promise<ApiResponseDto> {
    const result = await this.usersService.findAll(query, user.id);
    const data = {
      ...result,
      data: result.data.map((u) => this.usersService.toResponse(u)),
    };
    return ResponseHelper.success(data, '获取用户成功');
  }
  @Get(':id')
  async findOne(@Param('id') id: number): Promise<ApiResponseDto> {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('用户暂未注册');
    }
    const data = this.usersService.toResponse(user);
    return ResponseHelper.success(data, '获取用户成功');
  }
  @Roles(ManagementRoles.管理员, ManagementRoles.风控人)
  @Post()
  async create(@Body() body: CreateUserDto): Promise<ApiResponseDto> {
    const user = await this.usersService.create(body);
    const data = this.usersService.toResponse(user);
    return ResponseHelper.success(data, '创建用户成功');
  }
  @Post('login')
  async login(
    @Body() body: { username: string; password: string },
  ): Promise<ApiResponseDto> {
    const { username, password } = body;
    const user = await this.usersService.login(username);
    if (!user) {
      throw new NotFoundException('用户暂未注册');
    }
    if (user.password !== password) {
      throw new UnauthorizedException('密码错误');
    }
    const data = this.usersService.toResponse(user);
    return ResponseHelper.success(data, '登录成功');
  }
  @Put(':id')
  async update(
    @Param('id') id: number,
    @Body() body: CreateUserDto,
  ): Promise<ApiResponseDto> {
    const user = await this.usersService.update(id, body);
    const data = this.usersService.toResponse(user);
    return ResponseHelper.success(data, '更新用户成功');
  }
  @Delete(':id')
  async delete(
    @Param('id') id: number,
    @Query('admin_password') admin_password: string,
  ): Promise<ApiResponseDto> {
    if (admin_password !== process.env.ADMIN_PASSWORD) {
      throw new UnauthorizedException('管理员密码错误');
    }
    const user = await this.usersService.delete(id);
    const data = this.usersService.toResponse(user);
    return ResponseHelper.success(data, '删除用户成功');
  }
}
