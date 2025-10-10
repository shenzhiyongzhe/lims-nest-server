import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';
import * as crypto from 'crypto';

interface GetOrdersQuery {
  status?: OrderStatus;
  today?: boolean;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private async getAdminRole(adminId: number): Promise<string> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { role: true },
    });
    if (!admin) {
      throw new ForbiddenException('用户不存在');
    }
    return admin.role as string;
  }

  private async getPayeeIdByAdmin(adminId: number): Promise<number | null> {
    const payee = await this.prisma.payee.findFirst({
      where: { admin_id: adminId },
      select: { id: true },
    });
    return payee?.id ?? null;
  }

  async getOrders(adminId: number, query: GetOrdersQuery) {
    const { status, today = true } = query;

    const where: Prisma.OrderWhereInput = {};
    if (status) where.status = status;

    if (today) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      where.created_at = { gte: start, lt: end };
    }

    const role = await this.getAdminRole(adminId);
    if (role === '收款人') {
      const payeeId = await this.getPayeeIdByAdmin(adminId);
      if (!payeeId) {
        throw new BadRequestException('未绑定收款人');
      }
      where.payee_id = payeeId;
    }

    return this.prisma.order.findMany({
      where,
      include: { customer: true },
      orderBy: { created_at: 'desc' },
    });
  }

  async createOrder(adminId: number, body: CreateOrderDto) {
    const role = await this.getAdminRole(adminId);
    if (role !== '管理员') {
      throw new ForbiddenException('无权限');
    }

    const id =
      body.id && String(body.id).length > 0 ? body.id : crypto.randomUUID();
    const created = await this.prisma.order.create({
      data: {
        ...body,
        id,
        expires_at: body.expires_at
          ? new Date(body.expires_at)
          : new Date(Date.now() + 60 * 1000),
      },
    });
    return created;
  }

  async updateStatus(adminId: number, id: string, status: OrderStatus) {
    if (!id || !status) {
      throw new BadRequestException('缺少必要参数');
    }

    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    const role = await this.getAdminRole(adminId);
    if (role === '收款人') {
      const payeeId = await this.getPayeeIdByAdmin(adminId);
      if (!payeeId || order.payee_id !== payeeId) {
        throw new ForbiddenException('无权限');
      }
    }

    if (status === 'completed') {
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.order.update({
          where: { id },
          data: { status: 'completed', updated_at: new Date() },
        });

        if (!updated.payee_id) {
          throw new BadRequestException('订单未关联收款人');
        }

        const paidAt = new Date();
        const paidAtStr = paidAt.toISOString();

        await tx.repaymentRecord.create({
          data: {
            loan_id: updated.loan_id,
            user_id: updated.customer_id,
            paid_amount: updated.amount,
            paid_at: paidAtStr,
            payment_method: updated.payment_method,
            payee_id: updated.payee_id,
            remark: updated.remark ?? null,
            order_id: updated.id,
          },
        });

        const shareLink = await tx.shareLink.findUnique({
          where: { share_id: updated.share_id ?? undefined },
          select: { schedule_ids: true },
        });

        if (shareLink?.schedule_ids) {
          const ids = JSON.parse(shareLink.schedule_ids) as number[];
          if (Array.isArray(ids) && ids.length) {
            const schedules = await tx.repaymentSchedule.findMany({
              where: {
                id: { in: ids },
                status: {
                  in: ['pending', 'active', 'overdue', 'overtime'],
                },
              },
              orderBy: { period: 'asc' },
            });

            const portion =
              schedules.length > 0
                ? Number((Number(updated.amount) / schedules.length).toFixed(2))
                : 0;

            await Promise.all(
              schedules.map((s) =>
                tx.repaymentSchedule.update({
                  where: { id: s.id },
                  data: {
                    status: 'paid',
                    paid_amount: portion || Number(updated.amount),
                    paid_at: paidAtStr,
                  },
                }),
              ),
            );
          }
        }

        const agg = await tx.repaymentSchedule.aggregate({
          where: { loan_id: updated.loan_id, status: 'paid' },
          _sum: { paid_amount: true },
          _count: { _all: true },
        });
        const totalPaid = Number(agg?._sum?.paid_amount || 0);
        const countPaid = Number(agg?._count?._all || 0);
        await tx.loanAccount.update({
          where: { id: updated.loan_id },
          data: {
            receiving_amount: totalPaid,
            repaid_periods: countPaid,
          },
        });

        return updated;
      });
      return result;
    }

    const simpleUpdated = await this.prisma.order.update({
      where: { id },
      data: { status, updated_at: new Date() },
    });
    return simpleUpdated;
  }
}
