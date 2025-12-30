import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateCollectorAssetDto } from './dto/update-collector-asset.dto';
import { UpdateRiskControllerAssetDto } from './dto/update-risk-controller-asset.dto';

@Injectable()
export class AssetManagementService {
  constructor(private readonly prisma: PrismaService) {}

  // 获取collector资产数据，包含实时计算的总减后扣和总减罚金
  async findCollectorAsset(adminId: number) {
    // 获取或创建collector资产记录
    let asset = await this.prisma.collectorAssetManagement.findUnique({
      where: { admin_id: adminId },
      include: { admin: { select: { id: true, username: true } } },
    });

    if (!asset) {
      // 如果不存在，创建一条默认记录
      asset = await this.prisma.collectorAssetManagement.create({
        data: {
          admin_id: adminId,
          total_handling_fee: 0,
          total_fines: 0,
        },
        include: { admin: { select: { id: true, username: true } } },
      });
    }

    // 实时计算总减后扣和总减罚金
    const loanAccountIds = await this.getCollectorLoanAccountIds(adminId);
    const { reduced_handling_fee, reduced_fines } =
      await this.calculateReducedAmounts(loanAccountIds);

    return {
      id: asset.id,
      admin_id: asset.admin_id,
      admin: asset.admin,
      total_handling_fee: Number(asset.total_handling_fee),
      total_fines: Number(asset.total_fines),
      reduced_handling_fee,
      reduced_fines,
      created_at: asset.created_at,
      updated_at: asset.updated_at,
    };
  }

  // 获取risk_controller资产数据
  async findRiskControllerAsset(adminId: number) {
    // 获取或创建risk_controller资产记录
    let asset = await this.prisma.riskControllerAssetManagement.findUnique({
      where: { admin_id: adminId },
      include: { admin: { select: { id: true, username: true } } },
    });

    if (!asset) {
      // 如果不存在，创建一条默认记录
      asset = await this.prisma.riskControllerAssetManagement.create({
        data: {
          admin_id: adminId,
          total_amount: 0,
          reduced_amount: 0,
        },
        include: { admin: { select: { id: true, username: true } } },
      });
    }

    return {
      id: asset.id,
      admin_id: asset.admin_id,
      admin: asset.admin,
      total_amount: Number(asset.total_amount),
      reduced_amount: Number(asset.reduced_amount),
      created_at: asset.created_at,
      updated_at: asset.updated_at,
    };
  }

  // 获取所有collector资产（管理员用）
  async findAllCollectorAssets() {
    const assets = await this.prisma.collectorAssetManagement.findMany({
      include: { admin: { select: { id: true, username: true } } },
      orderBy: { admin_id: 'asc' },
    });

    // 为每个collector计算实时数据
    const result = await Promise.all(
      assets.map(async (asset) => {
        const loanAccountIds = await this.getCollectorLoanAccountIds(
          asset.admin_id,
        );
        const { reduced_handling_fee, reduced_fines } =
          await this.calculateReducedAmounts(loanAccountIds);

        return {
          id: asset.id,
          admin_id: asset.admin_id,
          admin: asset.admin,
          total_handling_fee: Number(asset.total_handling_fee),
          total_fines: Number(asset.total_fines),
          reduced_handling_fee,
          reduced_fines,
          created_at: asset.created_at,
          updated_at: asset.updated_at,
        };
      }),
    );

    return result;
  }

  // 获取所有risk_controller资产（管理员用）
  async findAllRiskControllerAssets() {
    const assets = await this.prisma.riskControllerAssetManagement.findMany({
      include: { admin: { select: { id: true, username: true } } },
      orderBy: { admin_id: 'asc' },
    });

    return assets.map((asset) => ({
      id: asset.id,
      admin_id: asset.admin_id,
      admin: asset.admin,
      total_amount: Number(asset.total_amount),
      reduced_amount: Number(asset.reduced_amount),
      created_at: asset.created_at,
      updated_at: asset.updated_at,
    }));
  }

  // 更新collector资产（管理员设定字段）
  async updateCollectorAsset(adminId: number, data: UpdateCollectorAssetDto) {
    // 确保记录存在
    const existing = await this.prisma.collectorAssetManagement.findUnique({
      where: { admin_id: adminId },
    });

    if (!existing) {
      // 如果不存在，创建一条记录
      return await this.prisma.collectorAssetManagement.create({
        data: {
          admin_id: adminId,
          total_handling_fee: data.total_handling_fee || 0,
          total_fines: data.total_fines || 0,
        },
        include: { admin: { select: { id: true, username: true } } },
      });
    }

    // 更新记录
    return await this.prisma.collectorAssetManagement.update({
      where: { admin_id: adminId },
      data: {
        total_handling_fee: data.total_handling_fee,
        total_fines: data.total_fines,
      },
      include: { admin: { select: { id: true, username: true } } },
    });
  }

  // 更新risk_controller资产（管理员设定字段）
  async updateRiskControllerAsset(
    adminId: number,
    data: UpdateRiskControllerAssetDto,
  ) {
    // 确保记录存在
    const existing = await this.prisma.riskControllerAssetManagement.findUnique(
      {
        where: { admin_id: adminId },
      },
    );

    if (!existing) {
      // 如果不存在，创建一条记录
      return await this.prisma.riskControllerAssetManagement.create({
        data: {
          admin_id: adminId,
          total_amount: data.total_amount || 0,
          reduced_amount: data.reduced_amount || 0,
        },
        include: { admin: { select: { id: true, username: true } } },
      });
    }

    // 更新记录
    return await this.prisma.riskControllerAssetManagement.update({
      where: { admin_id: adminId },
      data: {
        total_amount: data.total_amount,
        reduced_amount: data.reduced_amount,
      },
      include: { admin: { select: { id: true, username: true } } },
    });
  }

  // 获取collector关联的所有loan_account_ids
  private async getCollectorLoanAccountIds(adminId: number): Promise<string[]> {
    const roles = await this.prisma.loanAccountRole.findMany({
      where: {
        admin_id: adminId,
        role_type: 'collector',
      },
      select: {
        loan_account_id: true,
      },
    });

    return roles.map((r) => r.loan_account_id);
  }

  // 计算总减后扣和总减罚金（实时计算）
  private async calculateReducedAmounts(loanAccountIds: string[]): Promise<{
    reduced_handling_fee: number;
    reduced_fines: number;
  }> {
    if (loanAccountIds.length === 0) {
      return {
        reduced_handling_fee: 0,
        reduced_fines: 0,
      };
    }

    const allLoanAccounts = await this.prisma.loanAccount.findMany({
      where: {
        id: { in: loanAccountIds },
      },
      select: {
        handling_fee: true,
        total_fines: true,
      },
    });

    // 总减后扣：所有handling_fee的总和
    const reduced_handling_fee = allLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.handling_fee || 0),
      0,
    );

    // 总减罚金：所有total_fines的总和
    const reduced_fines = allLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.total_fines || 0),
      0,
    );

    return {
      reduced_handling_fee,
      reduced_fines,
    };
  }
}
