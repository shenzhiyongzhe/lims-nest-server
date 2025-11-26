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
    // 获取管理员信息
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { id: true, role: true, username: true },
    });

    if (!admin) {
      throw new Error('管理员不存在');
    }

    let where: any = { user_id: userId };

    // 根据管理员角色过滤数据
    if (admin.role === '负责人') {
      // 收款人只能看到自己负责的贷款的还款记录
      const loanAccounts = await this.prisma.loanAccount.findMany({
        where: { collector_id: admin.id },
        select: { id: true },
      });
      const loanIds = loanAccounts.map((la) => la.id);
      where.loan_id = { in: loanIds };
    }

    return this.prisma.repaymentRecord.findMany({
      where,
      include: {
        user: true,
        payee: true,
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
    if (admin.role === '负责人') {
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
        payee: true,
        order: true,
        loan_account: true,
      },
      orderBy: { paid_at: 'desc' },
    });
  }

  async findAll(params?: {
    userId?: number;
    loanId?: string;
    payeeId?: number;
    startDate?: Date;
    endDate?: Date;
  }): Promise<RepaymentRecord[]> {
    const where: any = {};

    if (params?.userId) where.user_id = params.userId;
    if (params?.loanId) where.loan_id = params.loanId;
    if (params?.payeeId) where.payee_id = params.payeeId;

    if (params?.startDate || params?.endDate) {
      where.paid_at = {};
      if (params.startDate) where.paid_at.gte = params.startDate;
      if (params.endDate) where.paid_at.lt = params.endDate;
    }

    return this.prisma.repaymentRecord.findMany({
      where,
      include: {
        user: true,
        payee: true,
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
      collector,
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

    // 根据管理员角色过滤数据
    if (admin.role === '风控人') {
      // 风控人只能看到自己负责的贷款的还款记录
      const loanAccounts = await this.prisma.loanAccount.findMany({
        where: { risk_controller_id: admin.id },
        select: { id: true },
      });
      const loanIds = loanAccounts.map((la) => la.id);

      if (loanIds.length === 0) {
        return {
          data: [],
          pagination: {
            page,
            pageSize,
            total: 0,
            totalPages: 0,
            hasNext: false,
            hasPrev: false,
          },
        };
      }

      where.loan_id = { in: loanIds };
    } else if (admin.role === '负责人') {
      // 负责人可以查看所有还款记录，但可以按负责人过滤
      if (collector) {
        const loanAccounts = await this.prisma.loanAccount.findMany({
          where: { collector_id: admin.id },
          select: { id: true },
        });
        const loanIds = loanAccounts.map((la) => la.id);

        if (loanIds.length === 0) {
          return {
            data: [],
            pagination: {
              page,
              pageSize,
              total: 0,
              totalPages: 0,
              hasNext: false,
              hasPrev: false,
            },
          };
        }

        where.loan_id = { in: loanIds };
      }
    }

    if (userId) where.user_id = userId;
    if (loanId) where.loan_id = loanId;
    if (payeeId) where.payee_id = payeeId;

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
          payee: true,
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
      paid_at: record.paid_at,
      payment_method: record.payment_method,
      payee_id: record.payee_id,
      payee_name: record.payee?.username || undefined,
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
