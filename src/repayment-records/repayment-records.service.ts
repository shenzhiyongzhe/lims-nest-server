import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { RepaymentRecord } from '@prisma/client';
import { RepaymentRecordResponseDto } from './dto/repayment-record-response.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { PaginatedResponseDto } from './dto/paginated-response.dto';

@Injectable()
export class RepaymentRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(
    userId: number,
    adminId: number,
  ): Promise<RepaymentRecord[]> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, role: true, username: true },
    });

    if (!admin) {
      throw new Error('管理员不存在');
    }

    let where: any = { user_id: userId };
    if (admin.role === 'RISK_CONTROLLER') {
      where.risk_controller_id = admin.id;
    } else if (admin.role === 'COLLECTOR') {
      where.collector_id = admin.id;
    }

    const loanAccounts = await this.prisma.loanAccount.findMany({
      where: where,
      select: { id: true },
    });
    const loanIds = loanAccounts.map((la) => la.id);
    where.loan_id = { in: loanIds };

    return this.prisma.repaymentRecord.findMany({
      where,
      include: {
        user: true,
        actual_collector: true,
        order: true,
        loan_account: true,
      },
      orderBy: { paid_at: 'desc' },
    });
  }

  async findByLoanId(
    loanId: string,
    adminId: number,
  ): Promise<RepaymentRecord[]> {
    // 获取管理员信息
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, role: true, username: true },
    });

    if (!admin) {
      throw new Error('管理员不存在');
    }

    let where: any = { loan_id: loanId };

    // 根据管理员角色过滤数据
    if (admin.role === 'COLLECTOR') {
      // 收款人只能看到自己负责的贷款的还款记录
      const loanAccount = await this.prisma.loanAccount.findFirst({
        where: {
          id: loanId,
          collector_id: admin.id,
        },
        select: { id: true },
      });

      if (!loanAccount) {
        return []; // 如果该贷款不是该收款人负责的，返回空数组
      }
    }

    return this.prisma.repaymentRecord.findMany({
      where,
      include: {
        user: true,
        actual_collector: true,
        order: true,
        loan_account: true,
      },
      orderBy: { paid_at: 'desc' },
    });
  }

  async findAllWithPagination(
    query: PaginationQueryDto,
    adminId: number,
  ): Promise<PaginatedResponseDto<RepaymentRecord>> {
    const {
      page = 1,
      pageSize = 20,
      userId,
      loanId,
      payeeId,
      startDate,
      endDate,
      riskControllerId,
      collectorId,
    } = query;
    const skip = (page - 1) * pageSize;

    // 获取管理员信息
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, role: true, username: true },
    });

    if (!admin) {
      throw new Error('管理员不存在');
    }

    let where: any = {};
    let loanAccountWhere: any = {};
    // 根据管理员角色过滤数据
    if (admin.role === 'RISK_CONTROLLER') {
      // 风控人只能看到自己负责的贷款的还款记录
      loanAccountWhere.risk_controller_id = admin.id;

      // 如果提供了 collectorId，只显示与该负责人共同关联的贷款
      if (collectorId) {
        loanAccountWhere.collector_id = collectorId;
      }
    } else if (admin.role === 'COLLECTOR') {
      // 负责人只能查看自己负责的贷款的还款记录
      loanAccountWhere.collector_id = admin.id;

      // 如果提供了 riskControllerId，只显示与该风控人共同关联的贷款
      if (riskControllerId) {
        loanAccountWhere.risk_controller_id = riskControllerId;
      }
    }

    let loanAccount = await this.prisma.loanAccount.findMany({
      where: loanAccountWhere,
      select: { id: true },
    });
    let loanIds = loanAccount.map((la) => la.id);
    where.loan_id = { in: loanIds };

    if (userId) where.user_id = userId;
    if (loanId) where.loan_id = loanId;
    if (payeeId) where.actual_collector_id = payeeId;

    if (startDate || endDate) {
      where.paid_at = {};
      if (startDate) where.paid_at.gte = new Date(startDate);
      if (endDate) where.paid_at.lt = new Date(endDate);
    }

    const [records, total] = await Promise.all([
      this.prisma.repaymentRecord.findMany({
        where,
        include: {
          user: true,
          actual_collector: true,
          order: true,
          loan_account: true,
        },
        orderBy: { paid_at: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.repaymentRecord.count({ where }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    return {
      data: records,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  toResponse(record: any): RepaymentRecordResponseDto {
    return {
      id: record.id,
      loan_id: record.loan_id,
      user_id: record.user_id,
      paid_amount: Number(record.paid_amount || 0),
      paid_amount_decimal: record.paid_amount_decimal
        ? Number(record.paid_amount_decimal)
        : undefined,
      paid_at: record.paid_at,
      payment_method: record.payment_method,
      actual_collector_id: record.actual_collector_id || undefined,
      actual_collector_name: record.actual_collector?.username || undefined,
      remark: record.remark || undefined,
      order_id: record.order_id,
      // 用户信息
      user_name: record.user?.username || undefined,
      user_address: record.user?.address || undefined,
      // 贷款账户信息
      repaid_periods: record.loan_account?.repaid_periods || 0,
      total_periods: record.loan_account?.total_periods || 'undefined',
    };
  }
}
