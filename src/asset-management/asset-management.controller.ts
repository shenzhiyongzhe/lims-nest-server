import {
  Controller,
  Get,
  Put,
  Param,
  ParseIntPipe,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AssetManagementService } from './asset-management.service';
import { UpdateCollectorAssetDto } from './dto/update-collector-asset.dto';
import { UpdateRiskControllerAssetDto } from './dto/update-risk-controller-asset.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { ManagementRoles } from '@prisma/client';

@Controller('asset-management')
@UseGuards(AuthGuard)
export class AssetManagementController {
  constructor(
    private readonly assetManagementService: AssetManagementService,
  ) {}

  // 获取指定collector的资产（用于"我的"页面）
  @Get('collector/:adminId')
  async getCollectorAsset(
    @Param('adminId', ParseIntPipe) adminId: number,
    @CurrentUser() user: { id: number; role: string },
  ): Promise<ApiResponseDto> {
    // 检查权限：只能查看自己的数据，或者管理员可以查看所有
    if (user.role !== 'ADMIN' && user.id !== adminId) {
      return ResponseHelper.error('无权访问', 403);
    }

    const asset = await this.assetManagementService.findCollectorAsset(adminId);
    return ResponseHelper.success(asset, '获取collector资产成功');
  }

  // 获取指定risk_controller的资产（用于"我的"页面）
  @Get('risk-controller/:adminId')
  async getRiskControllerAsset(
    @Param('adminId', ParseIntPipe) adminId: number,
    @CurrentUser() user: { id: number; role: string },
  ): Promise<ApiResponseDto> {
    // 检查权限：只能查看自己的数据，或者管理员可以查看所有
    if (user.role !== 'ADMIN' && user.id !== adminId) {
      return ResponseHelper.error('无权访问', 403);
    }

    const asset =
      await this.assetManagementService.findRiskControllerAsset(adminId);
    return ResponseHelper.success(asset, '获取risk_controller资产成功');
  }

  // 获取所有collector资产（管理员，需要RolesGuard）
  @Get('collector')
  @UseGuards(RolesGuard)
  @Roles(ManagementRoles.ADMIN)
  async getAllCollectorAssets(): Promise<ApiResponseDto> {
    const assets = await this.assetManagementService.findAllCollectorAssets();
    return ResponseHelper.success(assets, '获取所有collector资产成功');
  }

  // 获取所有risk_controller资产（管理员，需要RolesGuard）
  @Get('risk-controller')
  @UseGuards(RolesGuard)
  @Roles(ManagementRoles.ADMIN)
  async getAllRiskControllerAssets(): Promise<ApiResponseDto> {
    const assets =
      await this.assetManagementService.findAllRiskControllerAssets();
    return ResponseHelper.success(assets, '获取所有risk_controller资产成功');
  }

  // 更新collector资产（管理员）
  @Put('collector/:adminId')
  @UseGuards(RolesGuard)
  @Roles(ManagementRoles.ADMIN)
  async updateCollectorAsset(
    @Param('adminId', ParseIntPipe) adminId: number,
    @Body() data: UpdateCollectorAssetDto,
    @CurrentUser() user: { id: number; role: string; username?: string },
    @Req() request: Request,
  ): Promise<ApiResponseDto> {
    const ipAddress =
      (request.headers['x-forwarded-for'] as string) ||
      request.ip ||
      request.socket.remoteAddress ||
      undefined;

    const asset = await this.assetManagementService.updateCollectorAsset(
      adminId,
      data,
      user.id,
      user.username || '',
      ipAddress || '',
    );
    return ResponseHelper.success(asset, '更新collector资产成功');
  }

  // 更新risk_controller资产（管理员）
  @Put('risk-controller/:adminId')
  @UseGuards(RolesGuard)
  @Roles(ManagementRoles.ADMIN)
  async updateRiskControllerAsset(
    @Param('adminId', ParseIntPipe) adminId: number,
    @Body() data: UpdateRiskControllerAssetDto,
    @CurrentUser() user: { id: number; role: string; username?: string },
    @Req() request: Request,
  ): Promise<ApiResponseDto> {
    const ipAddress =
      (request.headers['x-forwarded-for'] as string) ||
      request.ip ||
      request.socket.remoteAddress ||
      undefined;

    // 获取用户名
    let username: string = user.username || '';
    if (!username) {
      // 如果装饰器没有提供用户名，从 cookies 获取
      const adminStr = request.cookies?.admin;
      if (adminStr) {
        try {
          const admin = JSON.parse(adminStr);
          username = admin.username || `admin_${user.id}`;
        } catch (e) {
          username = `admin_${user.id}`;
        }
      } else {
        username = `admin_${user.id}`;
      }
    }

    const asset = await this.assetManagementService.updateRiskControllerAsset(
      adminId,
      data,
      user.id,
      username,
      ipAddress || '',
    );
    return ResponseHelper.success(asset, '更新risk_controller资产成功');
  }

  // 查询 collector 减资历史
  @Get('collector/:adminId/history/:fieldName')
  async getCollectorReductionHistory(
    @Param('adminId', ParseIntPipe) adminId: number,
    @Param('fieldName') fieldName: string,
    @CurrentUser() user: { id: number; role: string },
  ): Promise<ApiResponseDto> {
    // 检查权限：只能查看自己的数据，或者管理员可以查看所有
    if (user.role !== 'ADMIN' && user.id !== adminId) {
      return ResponseHelper.error('无权访问', 403);
    }

    // 验证 fieldName
    if (fieldName !== 'reduced_handling_fee' && fieldName !== 'reduced_fines') {
      return ResponseHelper.error('无效的字段名', 400);
    }

    const history = await this.assetManagementService.getAssetReductionHistory(
      adminId,
      'collector',
      fieldName,
    );
    return ResponseHelper.success(history, '获取减资历史成功');
  }

  // 查询 risk_controller 减资历史
  @Get('risk-controller/:adminId/history/reduced_amount')
  async getRiskControllerReductionHistory(
    @Param('adminId', ParseIntPipe) adminId: number,
    @CurrentUser() user: { id: number; role: string },
  ): Promise<ApiResponseDto> {
    // 检查权限：只能查看自己的数据，或者管理员可以查看所有
    if (user.role !== 'ADMIN' && user.id !== adminId) {
      return ResponseHelper.error('无权访问', 403);
    }

    const history = await this.assetManagementService.getAssetReductionHistory(
      adminId,
      'risk_controller',
      'reduced_amount',
    );
    return ResponseHelper.success(history, '获取减资历史成功');
  }
}
