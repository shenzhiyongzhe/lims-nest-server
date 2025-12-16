import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentMethod } from '@prisma/client';
import type { Socket } from 'socket.io';

interface OrderPayload {
  id: string;
  customer_id: number;
  loan_id: string;
  amount: number | string;
  payment_periods: number;
  payment_method: PaymentMethod;
  remark?: string | null;
  customer: { address?: string };
}

@Injectable()
export class EventsService {
  private readonly wsConnections = new Map<string, Socket>();
  private readonly payeeConnections = new Map<number, string>();
  private readonly customerConnections = new Map<number, string>();
  private readonly pendingOrders = new Map<string, OrderPayload>();

  constructor(private readonly prisma: PrismaService) {}

  addConnection(
    type: 'payee' | 'customer',
    socket: Socket,
    opts: { payeeId?: number; userId?: number },
  ): string {
    const connectionId = socket.id;
    this.wsConnections.set(connectionId, socket);
    if (type === 'payee' && opts.payeeId) {
      this.payeeConnections.set(opts.payeeId, connectionId);
      console.log(
        `📊 当前活跃的收款人连接:`,
        Array.from(this.payeeConnections.keys()),
      );
    }
    if (type === 'customer' && opts.userId) {
      this.customerConnections.set(opts.userId, connectionId);
      console.log(`✅ 客户 ${opts.userId} 已连接，连接ID: ${connectionId}`);
    }

    return connectionId;
  }

  removeConnection(
    connectionId: string,
    type: 'payee' | 'customer',
    opts: { payeeId?: number; userId?: number },
  ): void {
    this.wsConnections.delete(connectionId);
    if (type === 'payee' && opts.payeeId) {
      const mapped = this.payeeConnections.get(opts.payeeId);
      if (mapped === connectionId) this.payeeConnections.delete(opts.payeeId);
    }
    if (type === 'customer' && opts.userId) {
      const mapped = this.customerConnections.get(opts.userId);
      if (mapped === connectionId) this.customerConnections.delete(opts.userId);
    }
  }

  private sendToConnection(connectionId: string, event: unknown): void {
    const socket = this.wsConnections.get(connectionId);
    if (!socket) return;
    socket.emit('message', event);
  }

  getCustomerConnectionId(userId: number): string | undefined {
    return this.customerConnections.get(userId);
  }

  getPayeeConnectionId(payeeId: number): string | undefined {
    return this.payeeConnections.get(payeeId);
  }

  async submitOrder(data: OrderPayload) {
    this.pendingOrders.set(data.id, data);
    await this.broadcastOrder(data);

    const customerId = Number(data.customer_id);
    const loanId = data.loan_id;
    const amount = data.amount;
    const paymentPeriods = Number(data.payment_periods ?? 0);
    const paymentMethod = data.payment_method;
    const remark = data.remark ?? null;
    const expiresAt = new Date(Date.now() + 180 * 1000);

    await this.prisma.order.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        customer_id: customerId,
        loan_id: loanId,
        amount,
        payment_periods: paymentPeriods,
        payment_method: paymentMethod,
        remark,
        expires_at: expiresAt,
      },
      update: {
        customer_id: customerId,
        loan_id: loanId,
        amount,
        payment_periods: paymentPeriods,
        payment_method: paymentMethod,
        remark,
        expires_at: expiresAt,
        status: 'pending',
        payee_id: null,
      },
    });

    return { success: true, message: '订单已提交，等待收款人抢单' };
  }

  async handleGrabOrder(payeeId: number, id: string) {
    const order = this.pendingOrders.get(id);
    if (!order) {
      return { success: false, message: '订单不存在或已过期' };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAmount = await this.prisma.repaymentRecord.aggregate({
      where: {
        payee_id: payeeId,
        paid_at: {
          gte: today.toISOString(),
          lt: tomorrow.toISOString(),
        },
      },
      _sum: {
        paid_amount: true,
      },
    });

    const payee = await this.prisma.payee.findUnique({
      where: { id: payeeId },
    });
    if (!payee) {
      return { success: false, message: '收款人不存在' };
    }

    const orderAmount = Number(order.amount);
    // 使用 remaining_limit 来判断是否足够
    if (payee.remaining_limit < orderAmount) {
      return { success: false, message: '当日额度不足' };
    }

    this.pendingOrders.delete(id);

    try {
      const customerId = Number(order.customer_id);
      const grabbedAt = new Date();
      // 使用事务确保订单创建和额度减少的原子性
      await this.prisma.$transaction(async (tx) => {
        await tx.order.upsert({
          where: { id },
          update: {
            payee_id: payeeId,
            status: 'grabbed',
            grabbed_at: grabbedAt,
            updated_at: grabbedAt,
          },
          create: {
            id,
            customer_id: customerId,
            loan_id: order.loan_id,
            amount: order.amount,
            payment_periods: Number(order.payment_periods ?? 0),
            payment_method: order.payment_method,
            remark: order.remark ?? null,
            status: 'grabbed',
            payee_id: payeeId,
            grabbed_at: grabbedAt,
            expires_at: new Date(Date.now() + 60 * 1000),
          },
        });
        // 减少剩余额度
        await tx.payee.update({
          where: { id: payeeId },
          data: {
            remaining_limit: {
              decrement: orderAmount,
            },
          },
        });
      });
    } catch (e) {
      // ignore
      console.log(e);
    }

    // 获取订单的完整信息（包括expires_at和amount）
    const orderDetails = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        amount: true,
        expires_at: true,
      },
    });

    const connectionId = this.customerConnections.get(order.customer_id);
    if (connectionId) {
      this.sendToConnection(connectionId, {
        type: 'order_grabbed',
        data: {
          id,
          payeeId,
          payeeName: payee.username,
          amount: orderDetails?.amount
            ? Number(orderDetails.amount)
            : Number(order.amount),
          expires_at:
            orderDetails?.expires_at?.toISOString() ||
            new Date(Date.now() + 60 * 1000).toISOString(),
        },
      });
    }

    return {
      success: true,
      message: '抢单成功',
      payeeId,
      payeeName: payee.username,
    };
  }

  private async calculatePayeePriority(orderData: OrderPayload) {
    const { customer, amount, payment_method } = orderData;
    console.log(
      `🔍 计算收款人优先级 - 订单: ${orderData.id}, 支付方式: ${payment_method}`,
    );

    const payees = await this.prisma.payee.findMany({
      include: {
        qrcode: {
          where: {
            qrcode_type: payment_method,
            active: true,
          },
        },
      },
    });

    console.log(`👥 找到 ${payees.length} 个收款人`);

    const payeePriorities: Array<{
      payee: {
        id: number;
        username: string;
        address?: string;
        payment_limit: number;
        remaining_limit: number;
      };
      priority: number;
      delay: number;
      remainingAmount: number;
    }> = [];

    for (const payee of payees) {
      console.log(`🔍 检查收款人 ${payee.id} (${payee.username})`);

      if (!payee.qrcode || payee.qrcode.length === 0) {
        console.log(`❌ 收款人 ${payee.id} 没有匹配的二维码，跳过`);
        continue;
      }

      console.log(
        `✅ 收款人 ${payee.id} 有 ${payee.qrcode.length} 个匹配的二维码`,
      );

      let priority = 0;
      let delay = 0;

      const historyCount = await this.prisma.repaymentRecord.count({
        where: {
          payee_id: payee.id,
          user_id: orderData.customer_id,
        },
      });
      if (historyCount > 0) {
        priority += 1000;
        delay = 1;
      }

      if (
        customer?.address &&
        payee.address &&
        customer.address === payee.address
      ) {
        priority += 500;
        delay = 10_000;
      }

      // 使用 remaining_limit 来判断是否足够
      if (payee.remaining_limit < Number(amount)) {
        continue;
      }

      if (delay === 0) delay = 30_000;
      payeePriorities.push({
        payee,
        priority,
        delay,
        remainingAmount: payee.remaining_limit,
      });

      console.log(
        `📊 收款人 ${payee.id} 优先级: ${priority}, 延迟: ${delay}ms, 剩余额度: ${payee.remaining_limit}`,
      );
    }

    const sortedPriorities = payeePriorities.sort(
      (a, b) => b.priority - a.priority,
    );
    console.log(
      `📋 最终收款人优先级排序:`,
      sortedPriorities.map(
        (p) => `${p.payee.id}(${p.payee.username}):${p.priority}:${p.delay}`,
      ),
    );

    return sortedPriorities;
  }

  private async broadcastOrder(orderData: OrderPayload) {
    // 检查订单是否已被抢单
    const existingOrder = await this.prisma.order.findUnique({
      where: { id: orderData.id },
      select: { status: true },
    });

    // 如果订单已被抢单，不进行广播
    if (existingOrder && existingOrder.status === 'grabbed') {
      console.log(`⚠️ 订单 ${orderData.id} 已被抢单，跳过广播`);
      return;
    }

    const priorities = await this.calculatePayeePriority(orderData);
    // 使用 Promise.all 处理所有延迟发送的消息
    await Promise.all(
      priorities.map(async ({ payee, delay }) => {
        const connectionId = this.payeeConnections.get(payee.id);
        console.log(`🔍 查找收款人 ${payee.id} 的连接ID:`, connectionId);

        if (connectionId) {
          // 在发送前再次检查订单状态，防止延迟期间被抢单
          const orderStatus = await this.prisma.order.findUnique({
            where: { id: orderData.id },
            select: { status: true },
          });

          if (orderStatus && orderStatus.status === 'grabbed') {
            console.log(
              `⚠️ 订单 ${orderData.id} 在延迟期间被抢单，跳过发送给收款人 ${payee.id}`,
            );
            return;
          }

          const message = {
            type: 'new_order',
            data: {
              id: orderData.id,
              loan_id: orderData.loan_id,
              customer_id: orderData.customer_id,
              customer: orderData.customer,
              payment_periods: orderData.payment_periods,
              amount: orderData.amount,
              payment_method: orderData.payment_method,
              remark: orderData.remark,
              timestamp: new Date().toISOString(),
            },
          };

          // 使用 setTimeout 实现延迟发送
          await new Promise((resolve) => setTimeout(resolve, delay));
          console.log(
            `📨 发送订单通知给收款人 ${payee.id} (延迟 ${delay}ms):`,
            message,
          );
          this.sendToConnection(connectionId, message);
        } else {
          console.log(`❌ 收款人 ${payee.id} 没有活跃连接`);
        }
      }),
    );
  }

  async findPayeeIdByAdmin(adminId: number): Promise<number | null> {
    const payee = await this.prisma.payee.findFirst({
      where: { admin_id: adminId },
      select: { id: true },
    });
    return payee?.id ?? null;
  }

  async getOrderById(orderId: string) {
    return this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        loan_id: true,
        amount: true,
        expires_at: true,
        customer_id: true,
        status: true,
      },
    });
  }
}
