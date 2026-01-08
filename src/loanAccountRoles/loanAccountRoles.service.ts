import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { transformRoleType } from '../utils/tool';

@Injectable()
export class LoanAccountRolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findUsersByRole(
    adminId: number,
    roleType: string,
    page: number,
    pageSize: number,
  ): Promise<any> {
    const where = {} as any;
    if (roleType !== 'ADMIN') {
      where.admin_id = adminId;
      where.role_type = transformRoleType(roleType);
    }
    console.log(`admin_id: ${adminId}, role_type: ${roleType}`);
    // 1. 先获取去重的loan_account_id列表
    const distinctLoanAccountIds = await this.prisma.loanAccountRole.findMany({
      where,
      select: {
        loan_account_id: true,
      },
      distinct: ['loan_account_id'],
      orderBy: {
        created_at: 'desc',
      },
    });
    console.log(`distinctLoanAccountIds: ${distinctLoanAccountIds}`);
    const total = distinctLoanAccountIds.length;
    const paginatedIds = distinctLoanAccountIds
      .slice((page - 1) * pageSize, page * pageSize)
      .map((item) => item.loan_account_id);

    // 2. 根据分页后的ID查询详细信息
    const loanAccountRoles = await this.prisma.loanAccountRole.findMany({
      where: {
        ...where,
        loan_account_id: {
          in: paginatedIds,
        },
      },
      include: {
        loan_account: {
          include: {
            user: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    // 2. 去重用户信息并组织数据
    const uniqueUsers = new Map();
    const processedLoanAccounts = new Set(); // 用于跟踪已处理的贷款账户

    loanAccountRoles.forEach((role) => {
      const loanAccount = role.loan_account;
      const userId = loanAccount.user.id;
      const loanAccountId = loanAccount.id;

      // 如果这个贷款账户已经处理过，跳过
      if (processedLoanAccounts.has(loanAccountId)) {
        return;
      }

      // 标记这个贷款账户为已处理
      processedLoanAccounts.add(loanAccountId);

      if (!uniqueUsers.has(userId)) {
        uniqueUsers.set(userId, {
          ...loanAccount.user,
          loan_accounts: [],
        });
      }

      // 添加贷款账户信息到用户对象中
      uniqueUsers.get(userId).loan_accounts.push({
        id: loanAccount.id,
        loan_amount: Number(loanAccount.loan_amount),
        capital: Number(loanAccount.capital),
        interest: Number(loanAccount.interest),
        due_start_date: loanAccount.due_start_date,
        due_end_date: loanAccount.due_end_date,
        status: loanAccount.status,
        handling_fee: Number(loanAccount.handling_fee),
        total_periods: loanAccount.total_periods,
        repaid_periods: loanAccount.repaid_periods,
        daily_repayment: Number(loanAccount.daily_repayment),
        company_cost: loanAccount.company_cost,
        created_at: loanAccount.created_at,
        created_by: loanAccount.created_by,
        updated_at: loanAccount.updated_at,
        // 角色信息
        roles: [roleType],
      });
    });
    const data = Array.from(uniqueUsers.values());
    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasNext: page < Math.ceil(total / pageSize),
        hasPrev: page > 1,
      },
    };
  }

  async findLoanAccountsByRole(
    adminId: number,
    roleType: string,
  ): Promise<any[]> {
    const where = {} as any;
    if (roleType !== 'ADMIN') {
      where.admin_id = adminId;
      where.role_type = transformRoleType(roleType);
    }
    // 先获取去重的loan_account_id列表
    const distinctLoanAccountIds = await this.prisma.loanAccountRole.findMany({
      where,
      select: {
        loan_account_id: true,
      },
      distinct: ['loan_account_id'],
      orderBy: {
        created_at: 'desc',
      },
    });

    // 根据去重的ID查询详细信息
    const loanAccountRoles = await this.prisma.loanAccountRole.findMany({
      where: {
        ...where,
        loan_account_id: {
          in: distinctLoanAccountIds.map((item) => item.loan_account_id),
        },
      },
      include: {
        loan_account: {
          include: {
            user: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    // 去重处理，确保每个贷款账户只出现一次
    const uniqueLoanAccounts = new Map();
    loanAccountRoles.forEach((role) => {
      const loanAccountId = role.loan_account.id;
      if (!uniqueLoanAccounts.has(loanAccountId)) {
        uniqueLoanAccounts.set(loanAccountId, {
          id: role.loan_account.id,
          loan_amount: Number(role.loan_account.loan_amount),
          capital: Number(role.loan_account.capital),
          interest: Number(role.loan_account.interest),
          due_start_date: role.loan_account.due_start_date,
          due_end_date: role.loan_account.due_end_date,
          status: role.loan_account.status,
          handling_fee: Number(role.loan_account.handling_fee),
          total_periods: role.loan_account.total_periods,
          repaid_periods: role.loan_account.repaid_periods,
          daily_repayment: Number(role.loan_account.daily_repayment),
          company_cost: role.loan_account.company_cost,
          created_at: role.loan_account.created_at,
          created_by: role.loan_account.created_by,
          updated_at: role.loan_account.updated_at,
          user: role.loan_account.user,
          role_type: role.role_type,
        });
      }
    });

    return Array.from(uniqueLoanAccounts.values());
  }

  async createRole(
    loanAccountId: string,
    adminId: number,
    roleType: string,
  ): Promise<any> {
    return this.prisma.loanAccountRole.create({
      data: {
        loan_account_id: loanAccountId,
        admin_id: adminId,
        role_type: roleType,
      },
    });
  }

  async deleteRole(
    loanAccountId: string,
    adminId: number,
    roleType: string,
  ): Promise<void> {
    await this.prisma.loanAccountRole.deleteMany({
      where: {
        loan_account_id: loanAccountId,
        admin_id: adminId,
        role_type: roleType,
      },
    });
  }
}
