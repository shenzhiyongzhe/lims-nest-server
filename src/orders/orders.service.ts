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
import { PayeeRankingService } from '../payee-ranking/payee-ranking.service';
import { PayeeDailyStatisticsService } from '../payee-daily-statistics/payee-daily-statistics.service';
import * as crypto from 'crypto';

interface GetOrdersQuery {
  status?: OrderStatus;
  today?: boolean;
  date?: string; // 日期字符串，格式：YYYY-MM-DD
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payeeRankingService: PayeeRankingService,
    private readonly payeeDailyStatisticsService: PayeeDailyStatisticsService,
  ) {}

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
    const { status, today = true, date } = query;

    const where: Prisma.OrderWhereInput = {};
    if (status) where.status = status;

    if (date) {
      // 如果指定了日期，按日期筛选（基于updated_at，因为审核时订单状态会更新）
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      const endDate = new Date(targetDate);
      endDate.setDate(endDate.getDate() + 1);
      where.updated_at = { gte: targetDate, lt: endDate };
    } else if (today) {
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
      include: {
        customer: true,
        payee: {
          select: {
            id: true,
            username: true,
          },
        },
      },
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

      // 1. 获取还款计划：找到最早的未还清计划，分配金额
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
        select: {
          id: true,
          capital: true,
          interest: true,
          fines: true,
          paid_capital: true,
          paid_interest: true,
          paid_amount: true,
          due_amount: true,
        },
      });

      let remainingAmount = paidAmount;
      const scheduleUpdates: Array<{
        id: number;
        paidCapital: number;
        paidInterest: number;
        paidFines: number;
        paidAmount: number;
        status: 'paid' | 'active' | 'pending';
      }> = [];

      for (const schedule of schedules) {
        if (remainingAmount <= 0) break;

        const currentPaid = Number(schedule.paid_amount || 0);
        const dueAmount = Number(schedule.due_amount);
        const scheduleRemaining = dueAmount - currentPaid;

        if (scheduleRemaining > 0) {
          const capital = Number(schedule.capital || 0);
          const interest = Number(schedule.interest || 0);
          const fines = Number(schedule.fines || 0);
          const currentPaidCapital = Number(schedule.paid_capital || 0);
          const currentPaidInterest = Number(schedule.paid_interest || 0);

          // 计算这个计划还需要还的本金、利息、罚金
          const remainingCapital = Math.max(0, capital - currentPaidCapital);
          const remainingInterest = Math.max(0, interest - currentPaidInterest);
          const remainingFines = fines; // 罚金通常是一次性添加的

          // 计算这个计划的总剩余金额
          const totalRemaining =
            remainingCapital + remainingInterest + remainingFines;

          if (remainingAmount >= scheduleRemaining) {
            // 完全还清这个计划
            const paidCapital = remainingCapital;
            const paidInterest = remainingInterest;
            const paidFines = remainingFines;

            scheduleUpdates.push({
              id: schedule.id,
              paidCapital: currentPaidCapital + paidCapital,
              paidInterest: currentPaidInterest + paidInterest,
              paidFines: paidFines,
              paidAmount: dueAmount,
              status: 'paid',
            });

            remainingAmount -= scheduleRemaining;
          } else {
            // 部分还清这个计划
            // 按比例分配：先还罚金，再还利息，最后还本金
            let allocatedCapital = 0;
            let allocatedInterest = 0;
            let allocatedFines = 0;
            let tempRemaining = remainingAmount;

            // 先还罚金
            if (tempRemaining > 0 && remainingFines > 0) {
              allocatedFines = Math.min(tempRemaining, remainingFines);
              tempRemaining -= allocatedFines;
            }

            // 再还利息
            if (tempRemaining > 0 && remainingInterest > 0) {
              allocatedInterest = Math.min(tempRemaining, remainingInterest);
              tempRemaining -= allocatedInterest;
            }

            // 最后还本金
            if (tempRemaining > 0 && remainingCapital > 0) {
              allocatedCapital = Math.min(tempRemaining, remainingCapital);
            }

            scheduleUpdates.push({
              id: schedule.id,
              paidCapital: currentPaidCapital + allocatedCapital,
              paidInterest: currentPaidInterest + allocatedInterest,
              paidFines: allocatedFines,
              paidAmount: currentPaid + remainingAmount,
              status: 'active' as 'active' | 'pending',
            });

            remainingAmount = 0;
          }
        }
      }

      // 2. 更新还款计划并为每个计划创建RepaymentRecord
      for (const update of scheduleUpdates) {
        const schedule = schedules.find((s) => s.id === update.id)!;
        const prevPaidCapital = Number(schedule.paid_capital || 0);
        const prevPaidInterest = Number(schedule.paid_interest || 0);
        const prevPaidFines = Number(schedule.fines || 0);

        // 计算本次新增的本金、利息、罚金
        const incPaidCapital = update.paidCapital - prevPaidCapital;
        const incPaidInterest = update.paidInterest - prevPaidInterest;
        const incPaidFines = update.paidFines - prevPaidFines;
        const incPaidAmount =
          update.paidAmount - Number(schedule.paid_amount || 0);

        // 更新还款计划
        await tx.repaymentSchedule.update({
          where: { id: update.id },
          data: {
            paid_capital: update.paidCapital,
            paid_interest: update.paidInterest,
            fines: update.paidFines,
            paid_amount: update.paidAmount,
            status: update.status,
            paid_at: update.status === 'paid' ? paidAt : null,
          },
        });

        // 为每个计划创建RepaymentRecord（只有当有新增金额时）
        if (incPaidAmount > 0) {
          await tx.repaymentRecord.create({
            data: {
              loan_id: order.loan_id,
              user_id: order.customer_id,
              paid_amount: incPaidAmount,
              paid_at: paidAtStr,
              payment_method: order.payment_method,
              payee_id: order.payee_id ?? 0,
              remark: order.remark ?? null,
              order_id: order.id,
              paid_capital: incPaidCapital > 0 ? incPaidCapital : null,
              paid_interest: incPaidInterest > 0 ? incPaidInterest : null,
              paid_fines: incPaidFines > 0 ? incPaidFines : null,
              repayment_schedule_id: update.id,
            },
          });
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

  /**
   * 获取审核订单列表
   */
  async getReviewOrders(adminId: number, status?: OrderStatus) {
    const where: Prisma.OrderWhereInput = {
      status: status ? status : { in: ['grabbed', 'completed'] },
    };

    const role = await this.getAdminRole(adminId);
    // 只有管理员可以查看所有订单，收款人只能查看自己的订单
    if (role === '收款人') {
      const payeeId = await this.getPayeeIdByAdmin(adminId);
      if (!payeeId) {
        throw new BadRequestException('未绑定收款人');
      }
      where.payee_id = payeeId;
    }

    return this.prisma.order.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            username: true,
            address: true,
          },
        },
        payee: {
          select: {
            id: true,
            username: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * 审核订单
   */
  async reviewOrder(
    adminId: number,
    orderId: string,
    actualPaidAmount: number,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payee: true,
      },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (order.status !== 'grabbed') {
      throw new BadRequestException('只能审核已抢单的订单');
    }

    if (!order.payee_id) {
      throw new BadRequestException('订单未关联收款人');
    }

    if (actualPaidAmount <= 0) {
      throw new BadRequestException('实付金额必须大于0');
    }

    // 获取管理员信息
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { username: true },
    });

    if (!admin) {
      throw new ForbiddenException('管理员不存在');
    }

    // 计算小数部分
    const decimalPart = actualPaidAmount % 1;

    return await this.prisma.$transaction(async (tx) => {
      // 1. 更新订单状态和实付金额
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'completed',
          actual_paid_amount: actualPaidAmount,
          processed_by_admin_id: adminId,
          processed_by_admin_name: admin.username,
          updated_at: new Date(),
        },
      });

      // 2. 更新排行榜（累加小数部分）
      if (decimalPart > 0 && order.payee_id) {
        await this.payeeRankingService.updateDecimalSum(
          order.payee_id,
          decimalPart,
        );
      }

      // 3. 更新每日收款统计
      if (order.payee_id) {
        await this.payeeDailyStatisticsService.updateDailyStatistics(
          order.payee_id,
          actualPaidAmount,
        );
      }

      return updatedOrder;
    });
  }
}
