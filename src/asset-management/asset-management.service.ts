import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateCollectorAssetDto } from './dto/update-collector-asset.dto';
import { UpdateRiskControllerAssetDto } from './dto/update-risk-controller-asset.dto';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { LoanAccount } from '@prisma/client';

@Injectable()
export class AssetManagementService implements OnModuleInit {
  private readonly logger = new Logger(AssetManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsService,
  ) {}

  // 获取collector资产数据，实时计算total_handling_fee和total_fines
  async findCollectorAsset(adminId: number) {
    // 获取admin信息
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, username: true },
    });

    // 获取数据库中的reduced字段
    const asset = await this.prisma.collectorAssetManagement.findUnique({
      where: { admin_id: adminId },
    });

    // 实时计算total_handling_fee和total_fines
    const loanAccountIds = await this.getCollectorLoanAccountIds(adminId);
    const { total_handling_fee, total_fines } =
      await this.calculateTotalAmounts(loanAccountIds);

    // 获取reduced字段（如果存在）
    const reduced_handling_fee = asset
      ? Number((asset as any).reduced_handling_fee || 0)
      : 0;
    const reduced_fines = asset ? Number((asset as any).reduced_fines || 0) : 0;

    return {
      id: asset?.id || 0,
      admin_id: adminId,
      admin: admin,
      total_handling_fee,
      total_fines,
      reduced_handling_fee,
      reduced_fines,
      created_at: asset?.created_at || null,
      updated_at: asset?.updated_at || null,
    };
  }

  // 获取risk_controller资产数据，实时计算total_amount
  async findRiskControllerAsset(adminId: number) {
    // 获取admin信息
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, username: true },
    });

    // 获取数据库中的reduced字段
    const asset = await this.prisma.riskControllerAssetManagement.findUnique({
      where: { admin_id: adminId },
    });

    // 实时计算total_amount
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
    let total_amount = 0;

    if (loanAccountIds.length > 0) {
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
      total_amount = allLoanAccounts.reduce(
        (sum, acc) =>
          sum +
          Number(acc.handling_fee || 0) +
          Number(acc.receiving_amount || 0) -
          Number(acc.company_cost || 0),
        0,
      );
    }

    // 获取reduced字段（如果存在）
    const reduced_amount = asset ? Number(asset.reduced_amount || 0) : 0;

    return {
      id: asset?.id || 0,
      admin_id: adminId,
      admin: admin,
      total_amount,
      reduced_amount,
      created_at: asset?.created_at || null,
      updated_at: asset?.updated_at || null,
    };
  }

  // 获取所有collector资产（管理员用），实时计算total_handling_fee和total_fines
  async findAllCollectorAssets() {
    // 获取所有collector的admin_id
    const collectorRoles = await this.prisma.loanAccountRole.findMany({
      where: {
        role_type: 'collector',
      },
      select: {
        admin_id: true,
      },
      distinct: ['admin_id'],
    });

    const collectorAdminIds = collectorRoles.map((r) => r.admin_id);

    if (collectorAdminIds.length === 0) {
      return [];
    }

    // 获取所有admin信息
    const admins = await this.prisma.admin.findMany({
      where: {
        id: { in: collectorAdminIds },
      },
      select: { id: true, username: true },
    });

    // 获取所有资产记录（用于reduced字段）
    const assets = await this.prisma.collectorAssetManagement.findMany({
      where: {
        admin_id: { in: collectorAdminIds },
      },
    });

    const assetMap = new Map(assets.map((asset) => [asset.admin_id, asset]));

    // 为每个collector实时计算total_handling_fee和total_fines
    const result = await Promise.all(
      admins.map(async (admin) => {
        const asset = assetMap.get(admin.id);
        const loanAccountIds = await this.getCollectorLoanAccountIds(admin.id);
        const { total_handling_fee, total_fines } =
          await this.calculateTotalAmounts(loanAccountIds);

        return {
          id: asset?.id || 0,
          admin_id: admin.id,
          admin: admin,
          total_handling_fee,
          total_fines,
          reduced_handling_fee: asset
            ? Number((asset as any).reduced_handling_fee || 0)
            : 0,
          reduced_fines: asset ? Number((asset as any).reduced_fines || 0) : 0,
          created_at: asset?.created_at || null,
          updated_at: asset?.updated_at || null,
        };
      }),
    );

    // 按admin_id排序
    return result.sort((a, b) => a.admin_id - b.admin_id);
  }

  // 获取所有risk_controller资产（管理员用），实时计算total_amount
  async findAllRiskControllerAssets() {
    // 获取所有risk_controller的admin_id
    const riskControllerRoles = await this.prisma.loanAccountRole.findMany({
      where: {
        role_type: 'risk_controller',
      },
      select: {
        admin_id: true,
      },
      distinct: ['admin_id'],
    });

    const riskControllerAdminIds = riskControllerRoles.map((r) => r.admin_id);

    if (riskControllerAdminIds.length === 0) {
      return [];
    }

    // 获取所有admin信息
    const admins = await this.prisma.admin.findMany({
      where: {
        id: { in: riskControllerAdminIds },
      },
      select: { id: true, username: true },
    });

    // 获取所有资产记录（用于reduced字段）
    const assets = await this.prisma.riskControllerAssetManagement.findMany({
      where: {
        admin_id: { in: riskControllerAdminIds },
      },
    });

    const assetMap = new Map(assets.map((asset) => [asset.admin_id, asset]));

    // 为每个risk_controller实时计算total_amount
    const result = await Promise.all(
      admins.map(async (admin) => {
        const asset = assetMap.get(admin.id);
        const roles = await this.prisma.loanAccountRole.findMany({
          where: {
            admin_id: admin.id,
            role_type: 'risk_controller',
          },
          select: {
            loan_account_id: true,
          },
        });

        const loanAccountIds = roles.map((r) => r.loan_account_id);
        let total_amount = 0;

        if (loanAccountIds.length > 0) {
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
          total_amount = allLoanAccounts.reduce(
            (sum, acc) =>
              sum +
              Number(acc.handling_fee || 0) +
              Number(acc.receiving_amount || 0) -
              Number(acc.company_cost || 0),
            0,
          );
        }

        return {
          id: asset?.id || 0,
          admin_id: admin.id,
          admin: admin,
          total_amount,
          reduced_amount: asset ? Number(asset.reduced_amount || 0) : 0,
          created_at: asset?.created_at || null,
          updated_at: asset?.updated_at || null,
        };
      }),
    );

    // 按admin_id排序
    return result.sort((a, b) => a.admin_id - b.admin_id);
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

  // 项目启动时初始化资产信息
  async onModuleInit() {
    this.logger.log('开始初始化资产信息...');
    try {
      await this.initializeAssets();
      this.logger.log('资产信息初始化完成');
    } catch (error) {
      this.logger.error('资产信息初始化失败:', error);
      // 不抛出错误，初始化失败不影响应用启动
    }
  }

  // 初始化所有缺失的资产记录
  private async initializeAssets(): Promise<void> {
    // 1. 查询所有有 collector 或 risk_controller 角色的 admin
    const roles = await this.prisma.loanAccountRole.findMany({
      where: {
        role_type: { in: ['collector', 'risk_controller'] },
      },
      select: {
        admin_id: true,
        role_type: true,
      },
      distinct: ['admin_id', 'role_type'],
    });

    if (roles.length === 0) {
      this.logger.log('未找到需要初始化的资产记录');
      return;
    }

    // 2. 批量查询所有已存在的资产记录
    const collectorAdminIds = roles
      .filter((r) => r.role_type === 'collector')
      .map((r) => r.admin_id);
    const riskControllerAdminIds = roles
      .filter((r) => r.role_type === 'risk_controller')
      .map((r) => r.admin_id);

    const existingCollectorAssets =
      collectorAdminIds.length > 0
        ? await this.prisma.collectorAssetManagement.findMany({
            where: { admin_id: { in: collectorAdminIds } },
            select: { admin_id: true },
          })
        : [];

    const existingRiskControllerAssets =
      riskControllerAdminIds.length > 0
        ? await this.prisma.riskControllerAssetManagement.findMany({
            where: { admin_id: { in: riskControllerAdminIds } },
            select: { admin_id: true },
          })
        : [];

    const existingCollectorIds = new Set(
      existingCollectorAssets.map((a) => a.admin_id),
    );
    const existingRiskControllerIds = new Set(
      existingRiskControllerAssets.map((a) => a.admin_id),
    );

    // 3. 找出需要初始化的 admin
    const collectorsToInit = collectorAdminIds.filter(
      (id) => !existingCollectorIds.has(id),
    );
    const riskControllersToInit = riskControllerAdminIds.filter(
      (id) => !existingRiskControllerIds.has(id),
    );

    this.logger.log(
      `需要初始化 ${collectorsToInit.length} 个 collector 资产，${riskControllersToInit.length} 个 risk_controller 资产`,
    );

    // 4. 初始化 collector 资产
    for (const adminId of collectorsToInit) {
      try {
        await this.initializeCollectorAsset(adminId);
      } catch (error) {
        this.logger.error(
          `初始化 collector 资产失败 (adminId: ${adminId}):`,
          error,
        );
      }
    }

    // 5. 初始化 risk_controller 资产
    for (const adminId of riskControllersToInit) {
      try {
        await this.initializeRiskControllerAsset(adminId);
      } catch (error) {
        this.logger.error(
          `初始化 risk_controller 资产失败 (adminId: ${adminId}):`,
          error,
        );
      }
    }

    this.logger.log(
      `成功初始化 ${collectorsToInit.length} 个 collector 资产，${riskControllersToInit.length} 个 risk_controller 资产`,
    );
  }

  // 初始化单个 collector 资产
  private async initializeCollectorAsset(adminId: number): Promise<void> {
    // 获取该 collector 关联的所有 loanAccount
    const loanAccountIds = await this.getCollectorLoanAccountIds(adminId);

    if (loanAccountIds.length === 0) {
      // 如果没有关联的 loanAccount，创建一条空记录
      await this.prisma.collectorAssetManagement.create({
        data: {
          admin_id: adminId,
          total_handling_fee: 0,
          total_fines: 0,
          reduced_handling_fee: 0,
          reduced_fines: 0,
        } as any,
      });
      this.logger.log(
        `创建 collector 资产记录 (adminId: ${adminId})，无关联 loanAccount`,
      );
      return;
    }

    // 查询所有关联的 loanAccount
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

    // 创建资产记录
    await this.prisma.collectorAssetManagement.create({
      data: {
        admin_id: adminId,
        total_handling_fee: total_handling_fee,
        total_fines: total_fines,
        reduced_handling_fee: 0,
        reduced_fines: 0,
      } as any,
    });

    this.logger.log(
      `创建 collector 资产记录 (adminId: ${adminId})，total_handling_fee: ${total_handling_fee}, total_fines: ${total_fines}`,
    );
  }

  // 初始化单个 risk_controller 资产
  private async initializeRiskControllerAsset(adminId: number): Promise<void> {
    // 获取该 risk_controller 关联的所有 loanAccount
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
      // 如果没有关联的 loanAccount，创建一条空记录
      await this.prisma.riskControllerAssetManagement.create({
        data: {
          admin_id: adminId,
          total_amount: 0,
          reduced_amount: 0,
        },
      });
      this.logger.log(
        `创建 risk_controller 资产记录 (adminId: ${adminId})，无关联 loanAccount`,
      );
      return;
    }

    // 查询所有关联的 loanAccount
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

    // 创建资产记录
    await this.prisma.riskControllerAssetManagement.create({
      data: {
        admin_id: adminId,
        total_amount: total_amount,
        reduced_amount: 0,
      },
    });

    this.logger.log(
      `创建 risk_controller 资产记录 (adminId: ${adminId})，total_amount: ${total_amount}`,
    );
  }
}
