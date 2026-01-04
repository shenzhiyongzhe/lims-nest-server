import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateCollectorAssetDto } from './dto/update-collector-asset.dto';
import { UpdateRiskControllerAssetDto } from './dto/update-risk-controller-asset.dto';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { LoanAccount } from '@prisma/client';

@Injectable()
export class AssetManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsService,
  ) {}

  // 获取collector资产数据，直接返回数据库数据
  async findCollectorAsset(adminId: number) {
    const asset = await this.prisma.collectorAssetManagement.findUnique({
      where: { admin_id: adminId },
      include: { admin: { select: { id: true, username: true } } },
    });

    if (!asset) {
      // 如果没有记录，返回所有字段为 0 的数据（不创建记录）
      return {
        id: 0,
        admin_id: adminId,
        admin: null,
        total_handling_fee: 0,
        total_fines: 0,
        reduced_handling_fee: 0,
        reduced_fines: 0,
        created_at: null,
        updated_at: null,
      };
    }

    return {
      id: asset.id,
      admin_id: asset.admin_id,
      admin: asset.admin,
      total_handling_fee: Number(asset.total_handling_fee),
      total_fines: Number(asset.total_fines),
      reduced_handling_fee: Number((asset as any).reduced_handling_fee || 0),
      reduced_fines: Number((asset as any).reduced_fines || 0),
      created_at: asset.created_at,
      updated_at: asset.updated_at,
    };
  }

  // 获取risk_controller资产数据，直接返回数据库数据
  async findRiskControllerAsset(adminId: number) {
    const asset = await this.prisma.riskControllerAssetManagement.findUnique({
      where: { admin_id: adminId },
      include: { admin: { select: { id: true, username: true } } },
    });

    if (!asset) {
      // 如果没有记录，返回所有字段为 0 的数据（不创建记录）
      return {
        id: 0,
        admin_id: adminId,
        admin: null,
        total_amount: 0,
        reduced_amount: 0,
        created_at: null,
        updated_at: null,
      };
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

  // 获取所有collector资产（管理员用），直接返回数据库数据
  async findAllCollectorAssets() {
    const assets = await this.prisma.collectorAssetManagement.findMany({
      include: { admin: { select: { id: true, username: true } } },
      orderBy: { admin_id: 'asc' },
    });

    return assets.map((asset) => ({
      id: asset.id,
      admin_id: asset.admin_id,
      admin: asset.admin,
      total_handling_fee: Number(asset.total_handling_fee),
      total_fines: Number(asset.total_fines),
      reduced_handling_fee: Number((asset as any).reduced_handling_fee || 0),
      reduced_fines: Number((asset as any).reduced_fines || 0),
      created_at: asset.created_at,
      updated_at: asset.updated_at,
    }));
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

  // 更新collector资产（累加更新 reduced 字段）
  async updateCollectorAsset(
    adminId: number,
    data: UpdateCollectorAssetDto,
    updatedByAdminId: number,
    updatedByAdminUsername: string,
    ipAddress?: string,
  ) {
    // 确保记录存在
    let existing = await this.prisma.collectorAssetManagement.findUnique({
      where: { admin_id: adminId },
    });

    if (!existing) {
      // 如果不存在，创建一条记录
      existing = await this.prisma.collectorAssetManagement.create({
        data: {
          admin_id: adminId,
          total_handling_fee: 0,
          total_fines: 0,
          reduced_handling_fee: 0,
          reduced_fines: 0,
        } as any,
      });
    }

    // 记录更新前的值
    const oldReducedHandlingFee = Number(
      (existing as any).reduced_handling_fee || 0,
    );
    const oldReducedFines = Number((existing as any).reduced_fines || 0);

    // 累加更新
    const inputHandlingFee = Number(data.reduced_handling_fee || 0);
    const inputFines = Number(data.reduced_fines || 0);
    const newReducedHandlingFee = oldReducedHandlingFee + inputHandlingFee;
    const newReducedFines = oldReducedFines + inputFines;

    // 更新记录
    const updated = await this.prisma.collectorAssetManagement.update({
      where: { admin_id: adminId },
      data: {
        reduced_handling_fee: newReducedHandlingFee,
        reduced_fines: newReducedFines,
      } as any,
      include: { admin: { select: { id: true, username: true } } },
    });

    // 记录历史（每个字段单独记录一条）
    if (inputHandlingFee > 0) {
      await this.recordAssetReductionHistory(
        adminId,
        'collector',
        'reduced_handling_fee',
        oldReducedHandlingFee,
        inputHandlingFee,
        newReducedHandlingFee,
        updatedByAdminId,
        updatedByAdminUsername,
      );
    }

    if (inputFines > 0) {
      await this.recordAssetReductionHistory(
        adminId,
        'collector',
        'reduced_fines',
        oldReducedFines,
        inputFines,
        newReducedFines,
        updatedByAdminId,
        updatedByAdminUsername,
      );
    }

    // 记录操作日志
    try {
      const oldData = {
        reduced_handling_fee: oldReducedHandlingFee,
        reduced_fines: oldReducedFines,
      };
      const newData: any = {};
      if (inputHandlingFee > 0) {
        newData.reduced_handling_fee = {
          old_value: oldReducedHandlingFee,
          input_value: inputHandlingFee,
          new_value: newReducedHandlingFee,
        };
      }
      if (inputFines > 0) {
        newData.reduced_fines = {
          old_value: oldReducedFines,
          input_value: inputFines,
          new_value: newReducedFines,
        };
      }

      await this.operationLogsService.logOperation({
        entity_type: 'CollectorAssetManagement',
        entity_id: adminId.toString(),
        operation_type: 'UPDATE',
        admin_id: updatedByAdminId,
        admin_username: updatedByAdminUsername,
        old_data: JSON.stringify(oldData),
        new_data: JSON.stringify(newData),
        ip_address: ipAddress,
      });
    } catch (error) {
      console.error('记录操作日志失败:', error);
    }

    return updated;
  }

  // 更新risk_controller资产（累加更新 reduced_amount 字段）
  async updateRiskControllerAsset(
    adminId: number,
    data: UpdateRiskControllerAssetDto,
    updatedByAdminId: number,
    updatedByAdminUsername: string,
    ipAddress?: string,
  ) {
    // 确保记录存在
    let existing = await this.prisma.riskControllerAssetManagement.findUnique({
      where: { admin_id: adminId },
    });

    if (!existing) {
      // 如果不存在，创建一条记录
      existing = await this.prisma.riskControllerAssetManagement.create({
        data: {
          admin_id: adminId,
          total_amount: 0,
          reduced_amount: 0,
        },
      });
    }

    // 记录更新前的值
    const oldReducedAmount = Number(existing.reduced_amount || 0);

    // 累加更新
    const inputAmount = Number(data.reduced_amount || 0);
    const newReducedAmount = oldReducedAmount + inputAmount;

    // 更新记录
    const updated = await this.prisma.riskControllerAssetManagement.update({
      where: { admin_id: adminId },
      data: {
        reduced_amount: newReducedAmount,
      },
      include: { admin: { select: { id: true, username: true } } },
    });

    // 记录历史
    if (inputAmount > 0) {
      await this.recordAssetReductionHistory(
        adminId,
        'risk_controller',
        'reduced_amount',
        oldReducedAmount,
        inputAmount,
        newReducedAmount,
        updatedByAdminId,
        updatedByAdminUsername,
      );
    }

    // 记录操作日志
    try {
      const oldData = { reduced_amount: oldReducedAmount };
      const newData = {
        reduced_amount: {
          old_value: oldReducedAmount,
          input_value: inputAmount,
          new_value: newReducedAmount,
        },
      };

      await this.operationLogsService.logOperation({
        entity_type: 'RiskControllerAssetManagement',
        entity_id: adminId.toString(),
        operation_type: 'UPDATE',
        admin_id: updatedByAdminId,
        admin_username: updatedByAdminUsername,
        old_data: JSON.stringify(oldData),
        new_data: JSON.stringify(newData),
        ip_address: ipAddress,
      });
    } catch (error) {
      console.error('记录操作日志失败:', error);
    }

    return updated;
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

  // 计算总后扣和总罚金
  private async calculateTotalAmounts(loanAccountIds: string[]): Promise<{
    total_handling_fee: number;
    total_fines: number;
  }> {
    if (loanAccountIds.length === 0) {
      return {
        total_handling_fee: 0,
        total_fines: 0,
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

    // 总后扣：所有handling_fee的总和
    const total_handling_fee = allLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.handling_fee || 0),
      0,
    );

    // 总罚金：所有total_fines的总和
    const total_fines = allLoanAccounts.reduce(
      (sum, acc) => sum + Number(acc.total_fines || 0),
      0,
    );

    return {
      total_handling_fee,
      total_fines,
    };
  }

  // 记录减资历史
  async recordAssetReductionHistory(
    adminId: number,
    assetType: 'collector' | 'risk_controller',
    fieldName: string,
    oldValue: number,
    inputValue: number,
    newValue: number,
    updatedByAdminId: number,
    updatedByAdminUsername: string,
  ): Promise<void> {
    try {
      await (this.prisma as any).assetReductionHistory.create({
        data: {
          admin_id: adminId,
          asset_type: assetType,
          field_name: fieldName,
          old_value: oldValue,
          input_value: inputValue,
          new_value: newValue,
          updated_by_admin_id: updatedByAdminId,
          updated_by_admin_username: updatedByAdminUsername,
        },
      });
    } catch (error) {
      console.error('记录减资历史失败:', error);
      // 不抛出错误，历史记录失败不影响主流程
    }
  }

  // 查询减资历史
  async getAssetReductionHistory(
    adminId: number,
    assetType: 'collector' | 'risk_controller',
    fieldName: string,
  ) {
    const history = await (this.prisma as any).assetReductionHistory.findMany({
      where: {
        admin_id: adminId,
        asset_type: assetType,
        field_name: fieldName,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    return history.map((h) => ({
      id: h.id,
      admin_id: h.admin_id,
      asset_type: h.asset_type,
      field_name: h.field_name,
      old_value: Number(h.old_value),
      input_value: Number(h.input_value),
      new_value: Number(h.new_value),
      updated_by_admin_id: h.updated_by_admin_id,
      updated_by_admin_username: h.updated_by_admin_username,
      created_at: h.created_at,
    }));
  }

  // 从 loanAccount 更新 collector 资产
  async updateCollectorAssetFromLoanAccount(
    adminId: number,
    loanAccount: LoanAccount,
  ): Promise<void> {
    try {
      // 获取所有相关 loanAccount
      const loanAccountIds = await this.getCollectorLoanAccountIds(adminId);
      if (loanAccountIds.length === 0) {
        return;
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

      // 计算总和
      const total_handling_fee = allLoanAccounts.reduce(
        (sum, acc) => sum + Number(acc.handling_fee || 0),
        0,
      );
      const total_fines = allLoanAccounts.reduce(
        (sum, acc) => sum + Number(acc.total_fines || 0),
        0,
      );

      // 确保记录存在
      const existing = await this.prisma.collectorAssetManagement.findUnique({
        where: { admin_id: adminId },
      });

      if (!existing) {
        await this.prisma.collectorAssetManagement.create({
          data: {
            admin_id: adminId,
            total_handling_fee: total_handling_fee,
            total_fines: total_fines,
            reduced_handling_fee: 0,
            reduced_fines: 0,
          } as any,
        });
      } else {
        await this.prisma.collectorAssetManagement.update({
          where: { admin_id: adminId },
          data: {
            total_handling_fee: total_handling_fee,
            total_fines: total_fines,
          },
        });
      }
    } catch (error) {
      console.error('更新 collector 资产失败:', error);
      // 不抛出错误，资产更新失败不影响主流程
    }
  }

  // 从 loanAccount 更新 risk_controller 资产
  async updateRiskControllerAssetFromLoanAccount(
    adminId: number,
    loanAccount: LoanAccount,
  ): Promise<void> {
    try {
      // 获取所有相关 loanAccount
      const roles = await this.prisma.loanAccountRole.findMany({
        where: {
          admin_id: adminId,
          role_type: 'risk_controller',
        },
        select: {
          loan_account_id: true,
        },
      });

      const loanAccountIds = roles.map((r) => r.loan_account_id);
      if (loanAccountIds.length === 0) {
        return;
      }

      const allLoanAccounts = await this.prisma.loanAccount.findMany({
        where: {
          id: { in: loanAccountIds },
        },
        select: {
          handling_fee: true,
          receiving_amount: true,
          company_cost: true,
        },
      });

      // 计算总和：handling_fee + receiving_amount - company_cost
      const total_amount = allLoanAccounts.reduce(
        (sum, acc) =>
          sum +
          Number(acc.handling_fee || 0) +
          Number(acc.receiving_amount || 0) -
          Number(acc.company_cost || 0),
        0,
      );

      // 确保记录存在
      const existing =
        await this.prisma.riskControllerAssetManagement.findUnique({
          where: { admin_id: adminId },
        });

      if (!existing) {
        await this.prisma.riskControllerAssetManagement.create({
          data: {
            admin_id: adminId,
            total_amount: total_amount,
            reduced_amount: 0,
          },
        });
      } else {
        await this.prisma.riskControllerAssetManagement.update({
          where: { admin_id: adminId },
          data: {
            total_amount: total_amount,
          },
        });
      }
    } catch (error) {
      console.error('更新 risk_controller 资产失败:', error);
      // 不抛出错误，资产更新失败不影响主流程
    }
  }
}
