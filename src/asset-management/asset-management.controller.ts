import {
  Controller,
  Get,
  Put,
  Param,
  ParseIntPipe,
  Body,
  UseGuards,
} from '@nestjs/common';
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
    if (user.role !== '管理员' && user.id !== adminId) {
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
    if (user.role !== '管理员' && user.id !== adminId) {
      return ResponseHelper.error('无权访问', 403);
    }

    const asset =
      await this.assetManagementService.findRiskControllerAsset(adminId);
    return ResponseHelper.success(asset, '获取risk_controller资产成功');
  }

  // 获取所有collector资产（管理员，需要RolesGuard）
  @Get('collector')
  @UseGuards(RolesGuard)
  @Roles(ManagementRoles.管理员)
  async getAllCollectorAssets(): Promise<ApiResponseDto> {
    const assets = await this.assetManagementService.findAllCollectorAssets();
    return ResponseHelper.success(assets, '获取所有collector资产成功');
  }

  // 获取所有risk_controller资产（管理员，需要RolesGuard）
  @Get('risk-controller')
  @UseGuards(RolesGuard)
  @Roles(ManagementRoles.管理员)
  async getAllRiskControllerAssets(): Promise<ApiResponseDto> {
    const assets =
      await this.assetManagementService.findAllRiskControllerAssets();
    return ResponseHelper.success(assets, '获取所有risk_controller资产成功');
  }

  // 更新collector资产（管理员）
  @Put('collector/:adminId')
  @UseGuards(RolesGuard)
  @Roles(ManagementRoles.管理员)
  async updateCollectorAsset(
    @Param('adminId', ParseIntPipe) adminId: number,
    @Body() data: UpdateCollectorAssetDto,
  ): Promise<ApiResponseDto> {
    const asset = await this.assetManagementService.updateCollectorAsset(
      adminId,
      data,
    );
    return ResponseHelper.success(asset, '更新collector资产成功');
  }

  // 更新risk_controller资产（管理员）
  @Put('risk-controller/:adminId')
  @UseGuards(RolesGuard)
  @Roles(ManagementRoles.管理员)
  async updateRiskControllerAsset(
    @Param('adminId', ParseIntPipe) adminId: number,
    @Body() data: UpdateRiskControllerAssetDto,
  ): Promise<ApiResponseDto> {
    const asset = await this.assetManagementService.updateRiskControllerAsset(
      adminId,
      data,
    );
    return ResponseHelper.success(asset, '更新risk_controller资产成功');
  }
}
