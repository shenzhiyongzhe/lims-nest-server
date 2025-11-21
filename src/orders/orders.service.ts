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

  /**
   * 处理付款（部分还清或完全还清）
   * @param adminId 管理员ID
   * @param orderId 订单ID
   * @param paidAmount 实际支付金额
   * @param isPartial 是否为部分还清
   */
  private async processPayment(
    adminId: number,
    orderId: string,
    paidAmount: number,
    isPartial: boolean,
  ) {
    // 验证订单
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (order.status !== 'grabbed') {
      throw new BadRequestException('订单状态不正确，只能处理已抢单的订单');
    }

    // 验证权限
    const role = await this.getAdminRole(adminId);
    if (role === '收款人') {
      const payeeId = await this.getPayeeIdByAdmin(adminId);
      if (!payeeId || order.payee_id !== payeeId) {
        throw new ForbiddenException('无权限');
      }
    }

    if (!order.payee_id) {
      throw new BadRequestException('订单未关联收款人');
    }

    if (paidAmount <= 0) {
      throw new BadRequestException('支付金额必须大于0');
    }

    if (paidAmount > Number(order.amount)) {
      throw new BadRequestException('支付金额不能超过订单金额');
    }

    return await this.prisma.$transaction(async (tx) => {
      const paidAt = new Date();
      const paidAtStr = paidAt.toISOString();

      // 1. 创建还款记录
      await tx.repaymentRecord.create({
        data: {
          loan_id: order.loan_id,
          user_id: order.customer_id,
          paid_amount: paidAmount,
          paid_at: paidAtStr,
          payment_method: order.payment_method,
          payee_id: order.payee_id ?? 0,
          remark: order.remark ?? null,
          order_id: order.id,
        },
      });

      // 2. 更新还款计划：找到最早的未还清计划，分配金额
      const schedules = await tx.repaymentSchedule.findMany({
        where: {
          loan_id: order.loan_id,
          status: {
            in: ['pending', 'active'],
          },
        },
        orderBy: {
          due_start_date: 'asc',
        },
      });

      let remainingAmount = paidAmount;
      for (const schedule of schedules) {
        if (remainingAmount <= 0) break;

        const currentPaid = Number(schedule.paid_amount || 0);
        const dueAmount = Number(schedule.due_amount);
        const scheduleRemaining = dueAmount - currentPaid;

        if (scheduleRemaining > 0) {
          if (remainingAmount >= scheduleRemaining) {
            // 完全还清这个计划
            await tx.repaymentSchedule.update({
              where: { id: schedule.id },
              data: {
                paid_amount: dueAmount,
                status: 'paid',
                paid_at: paidAt,
              },
            });
            remainingAmount -= scheduleRemaining;
          } else {
            // 部分还清这个计划
            await tx.repaymentSchedule.update({
              where: { id: schedule.id },
              data: {
                paid_amount: currentPaid + remainingAmount,
                // 保持当前状态（pending 或 active）
              },
            });
            remainingAmount = 0;
          }
        }
      }

      // 3. 更新 LoanAccount
      // 计算 receiving_amount：所有还款计划的 paid_amount 总和
      const allSchedules = await tx.repaymentSchedule.findMany({
        where: { loan_id: order.loan_id },
        select: { paid_amount: true },
      });
      const totalReceiving = allSchedules.reduce(
        (sum, schedule) => sum + Number(schedule.paid_amount || 0),
        0,
      );

      // 计算 repaid_periods：状态为 paid 的计划数量
      const paidSchedules = await tx.repaymentSchedule.findMany({
        where: {
          loan_id: order.loan_id,
          status: 'paid',
        },
      });
      const repaidPeriods = paidSchedules.length;

      await tx.loanAccount.update({
        where: { id: order.loan_id },
        data: {
          receiving_amount: totalReceiving,
          repaid_periods: repaidPeriods,
        },
      });

      // 4. 更新订单状态和备注
      let updatedRemark = order.remark;
      if (isPartial) {
        updatedRemark = updatedRemark
          ? `${updatedRemark} | 部分还清`
          : '部分还清';
      }

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'completed',
          remark: updatedRemark,
          updated_at: paidAt,
        },
      });

      return updated;
    });
  }

  /**
   * 部分还清
   */
  async partialPayment(adminId: number, orderId: string, paidAmount: number) {
    return this.processPayment(adminId, orderId, paidAmount, true);
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
      // 使用统一的处理逻辑，金额为订单金额
      return this.processPayment(adminId, id, Number(order.amount), false);
    }

    const simpleUpdated = await this.prisma.order.update({
      where: { id },
      data: { status, updated_at: new Date() },
    });
    return simpleUpdated;
  }
}
