import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatus, PaymentFeedback, ReviewStatus } from '@prisma/client';
import type { Prisma, RepaymentScheduleStatus } from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';
import { PayeeRankingService } from '../payee-ranking/payee-ranking.service';
import { PayeeDailyStatisticsService } from '../payee-daily-statistics/payee-daily-statistics.service';
import { EmailService } from '../email/email.service';
import * as crypto from 'crypto';

type LoanAccountStatus = 'pending' | 'settled';

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
    private readonly emailService: EmailService,
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
    if (role === 'PAYEE') {
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

  /**
   * 更新订单支付反馈
   */
  async updatePaymentFeedback(id: string, paymentFeedback: PaymentFeedback) {
    if (!id || !paymentFeedback) {
      throw new BadRequestException('缺少必要参数');
    }

    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        payee: {
          include: {
            admin: {
              select: {
                email: true,
              },
            },
          },
        },
        customer: {
          select: {
            username: true,
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    // 构建更新数据
    const updateData: any = {
      payment_feedback: paymentFeedback,
      updated_at: new Date(),
    };

    // 如果支付反馈为失败，同时更新订单状态为 completed
    if (paymentFeedback === 'failed') {
      updateData.status = 'completed';
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: updateData,
    });

    // 如果支付反馈为成功，发送邮件给收款人
    if (paymentFeedback === 'success' && order.payee?.admin?.email) {
      const customerName = order.customer?.username || '未知客户';
      const paymentAmount = Number(order.amount);
      this.emailService
        .sendPaymentSuccessEmail(
          order.payee.admin.email,
          customerName,
          paymentAmount,
          order.id,
        )
        .catch((error) => {
          // 邮件发送失败不影响主流程，只记录日志
          console.error('发送支付成功邮件失败:', error);
        });
    }

    return updated;
  }

  /**
   * 更新订单审核状态
   */
  async updateReviewStatus(
    adminId: number,
    id: string,
    reviewStatus: ReviewStatus,
    status?: OrderStatus,
  ) {
    if (!id || !reviewStatus) {
      throw new BadRequestException('缺少必要参数');
    }

    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    // 构建更新数据
    const updateData: any = {
      review_status: reviewStatus,
      updated_at: new Date(),
    };

    // 如果提供了状态，同时更新订单状态
    if (status) {
      updateData.status = status;
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: updateData,
    });

    return updated;
  }

  /**
   * 获取审核订单列表
   */
  async getReviewOrders(
    adminId: number,
    reviewStatus?: ReviewStatus,
    date?: string,
  ) {
    const where: Prisma.OrderWhereInput = {
      review_status: reviewStatus ? reviewStatus : 'pending_review',
      needs_manual_processing: false,
    };

    // 如果提供了日期，按日期筛选（基于updated_at，因为审核时订单状态会更新）
    if (date) {
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      const endDate = new Date(targetDate);
      endDate.setDate(endDate.getDate() + 1);
      where.updated_at = { gte: targetDate, lt: endDate };
    }

    const role = await this.getAdminRole(adminId);
    // 只有管理员可以查看所有订单，收款人只能查看自己的订单
    if (role === 'PAYEE') {
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
        customer: {
          select: {
            username: true,
          },
        },
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

    // 计算整数部分
    const actualPaidAmountInt = Math.floor(actualPaidAmount);
    const decimalPart = actualPaidAmount % 1;

    return await this.prisma.$transaction(async (tx) => {
      // 获取前两个还款计划
      const schedules = await tx.repaymentSchedule.findMany({
        where: {
          loan_id: order.loan_id,
          status: { in: ['pending'] },
        },
        orderBy: {
          due_start_date: 'asc',
        },
        take: 2,
      });

      if (schedules.length === 0) {
        throw new BadRequestException('还款计划不存在');
      }

      // 计算第一期的金额 = 本金 + 利息
      const firstPeriodAmount =
        Number(schedules[0].capital || 0) + Number(schedules[0].interest || 0);

      if (firstPeriodAmount <= 0) {
        throw new BadRequestException('第一期的本金和利息不能为0');
      }

      // 计算前两期的总金额
      let firstTwoPeriodsAmount = firstPeriodAmount;
      if (schedules.length >= 2) {
        const secondPeriodAmount =
          Number(schedules[1].capital || 0) +
          Number(schedules[1].interest || 0);
        firstTwoPeriodsAmount = firstPeriodAmount + secondPeriodAmount;
      }

      // 判断实付金额是否等于第一期金额，或者是否等于前两期总金额
      const canAutoProcess =
        actualPaidAmountInt === firstPeriodAmount ||
        (schedules.length >= 2 &&
          actualPaidAmountInt === firstTwoPeriodsAmount);

      // 如果可以自动处理，正常处理；否则需要手动处理
      if (!canAutoProcess) {
        // 需要手动处理
        // 1. 获取第一个还款计划用于创建还款记录
        const schedules = await tx.repaymentSchedule.findMany({
          where: {
            loan_id: order.loan_id,
            status: { in: ['pending'] },
          },
          orderBy: {
            due_start_date: 'asc',
          },
          take: 1, // 只需要第一个
        });

        // 2. 创建还款记录（绑定到 schedules[0]，如果存在）
        if (!order.payee_id || !order.payee) {
          throw new BadRequestException('订单未关联收款人');
        }

        if (schedules.length > 0) {
          await tx.repaymentRecord.create({
            data: {
              loan_id: order.loan_id,
              user_id: order.customer_id,
              paid_amount: actualPaidAmountInt,
              paid_amount_decimal: actualPaidAmount,
              paid_at: new Date(),
              payment_method: order.payment_method,
              actual_collector_id: order.payee.admin_id,
              remark: '客户还款',
              order_id: orderId,
              collected_by_type: 'grabbed',
              paid_capital: 0, // 手动处理时，暂时设为0，后续手动处理时再更新
              paid_interest: 0,
              repayment_schedule_id: schedules[0].id,
            },
          });
        }

        // 3. 更新订单状态为需要手动处理
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'completed',
            actual_paid_amount: actualPaidAmountInt,
            needs_manual_processing: true,
            manual_processing_status: 'unprocessed',
            updated_at: new Date(),
          } as any,
        });

        // 4. 更新排行榜（累加小数部分）
        if (decimalPart > 0 && order.payee_id) {
          await this.payeeRankingService.updateDecimalSum(
            order.payee_id,
            decimalPart,
          );
        }

        // 5. 更新每日收款统计
        if (order.payee_id) {
          await this.payeeDailyStatisticsService.updateDailyStatistics(
            order.payee_id,
            actualPaidAmountInt,
          );
        }

        // 6. 发送手动处理通知邮件给负责人
        // 在事务外发送邮件，避免影响事务
        const loanAccount = await this.prisma.loanAccount.findUnique({
          where: { id: order.loan_id },
          include: {
            collector: {
              select: {
                email: true,
              },
            },
          },
        });

        if (loanAccount?.collector?.email) {
          const customerName = order.customer?.username || '未知客户';
          this.emailService
            .sendManualProcessingEmail(
              loanAccount.collector.email,
              orderId,
              customerName,
              order.loan_id,
              actualPaidAmount,
            )
            .catch((error) => {
              // 邮件发送失败不影响主流程，只记录日志
              console.error('发送手动处理通知邮件失败:', error);
            });
        }

        return updatedOrder;
      } else {
        // 可以自动处理：实付金额等于第一期金额，或者等于前两期总金额
        // schedules 已经在上面获取了（前两个）
        // 重新获取所有需要更新的还款计划（可能只需要前1个或前2个）
        const allSchedules = await tx.repaymentSchedule.findMany({
          where: {
            loan_id: order.loan_id,
            status: { in: ['pending'] },
          },
          orderBy: {
            due_start_date: 'asc',
          },
        });

        if (allSchedules.length === 0) {
          throw new BadRequestException('还款计划不存在');
        }

        // 判断需要更新几期
        let periodsToUpdate: number;
        if (actualPaidAmountInt === firstPeriodAmount) {
          // 实付金额等于第一期，只更新第一期
          periodsToUpdate = 1;
        } else if (
          allSchedules.length >= 2 &&
          actualPaidAmountInt === firstTwoPeriodsAmount
        ) {
          // 实付金额等于前两期总金额，更新前两期
          periodsToUpdate = 2;
        } else {
          // 这种情况理论上不应该发生（因为 canAutoProcess 已经判断过了）
          throw new BadRequestException('无法自动处理，请手动处理');
        }

        if (allSchedules.length < periodsToUpdate) {
          throw new BadRequestException(
            `还款计划数量不足，需要 ${periodsToUpdate} 期`,
          );
        }

        let totalPaidCapital = 0;
        let totalPaidInterest = 0;

        // 2. 创建还款记录（绑定到 allSchedules[0]）
        if (!order.payee_id || !order.payee) {
          throw new BadRequestException('订单未关联收款人');
        }
        const actualCollectorIdForAuto = order.payee.admin_id;
        // 3. 更新对应期数的还款计划
        for (let i = 0; i < periodsToUpdate; i++) {
          const schedule = allSchedules[i];
          const scheduleCapital = Number(schedule.capital || 0);
          const scheduleInterest = Number(schedule.interest || 0);

          await tx.repaymentSchedule.update({
            where: { id: schedule.id },
            data: {
              status: 'paid',
              paid_capital: scheduleCapital,
              paid_interest: scheduleInterest,
              paid_amount: scheduleCapital + scheduleInterest,
              paid_at: new Date(),
              operator_admin_id: order.payee_id,
              operator_admin_name: order.payee.username,
              collected_by_type: 'grabbed',
            },
          });
          totalPaidCapital += scheduleCapital;
          totalPaidInterest += scheduleInterest;
        }

        const repaymentRecord = await tx.repaymentRecord.create({
          data: {
            loan_id: order.loan_id,
            user_id: order.customer_id,
            paid_amount: actualPaidAmountInt,
            paid_amount_decimal: actualPaidAmount,
            paid_at: new Date(),
            payment_method: order.payment_method,
            actual_collector_id: actualCollectorIdForAuto,
            remark: '客户还款',
            order_id: orderId,
            collected_by_type: 'grabbed',
            paid_capital: totalPaidCapital,
            paid_interest: totalPaidInterest,
            repayment_schedule_id: allSchedules[0].id,
          },
        });

        // 4. 更新 LoanAccount
        const loanAccount = await tx.loanAccount.findUnique({
          where: { id: order.loan_id },
        });

        if (loanAccount) {
          const currentRepaidPeriods = await tx.repaymentSchedule.count({
            where: {
              loan_id: order.loan_id,
              status: 'paid',
            },
          });
          let status: LoanAccountStatus = 'pending';
          if (currentRepaidPeriods == loanAccount.total_periods) {
            status = 'settled' as LoanAccountStatus;
          }
          await tx.loanAccount.update({
            where: { id: order.loan_id },
            data: {
              receiving_amount: {
                increment: actualPaidAmountInt,
              },
              paid_capital: {
                increment: totalPaidCapital,
              },
              paid_interest: {
                increment: totalPaidInterest,
              },
              repaid_periods: currentRepaidPeriods,
              status: status,
            } as any,
          });
        }

        // 5. 更新订单状态
        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'completed',
            actual_paid_amount: actualPaidAmount,
            needs_manual_processing: false,
            updated_at: new Date(),
          } as any,
        });

        // 6. 更新排行榜（累加小数部分）
        if (decimalPart > 0 && order.payee_id) {
          await this.payeeRankingService.updateDecimalSum(
            order.payee_id,
            decimalPart,
          );
        }

        // 7. 更新每日收款统计
        if (order.payee_id) {
          await this.payeeDailyStatisticsService.updateDailyStatistics(
            order.payee_id,
            actualPaidAmountInt,
          );
        }

        return updatedOrder;
      }
    });
  }

  /**
   * 获取需要手动处理的订单列表
   */
  async getManualProcessingOrders(adminId: number) {
    const role = await this.getAdminRole(adminId);
    // 允许 collector（收款人）和管理员访问
    if (role !== 'COLLECTOR' && role !== 'ADMIN') {
      throw new ForbiddenException('无权限访问');
    }

    return this.prisma.order
      .findMany({
        where: {
          needs_manual_processing: true,
          manual_processing_status: 'unprocessed',
        } as any,
        include: {
          customer: {
            select: {
              id: true,
              username: true,
              phone: true,
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
        orderBy: { updated_at: 'desc' },
      })
      .then(async (orders) => {
        // 为每个订单获取 loanAccount 信息
        const ordersWithLoanAccount = await Promise.all(
          orders.map(async (order) => {
            const loanAccount = await this.prisma.loanAccount.findUnique({
              where: { id: order.loan_id },
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                  },
                },
                repaymentSchedules: {
                  where: {
                    status: 'pending',
                  },
                  orderBy: {
                    due_start_date: 'asc',
                  },
                },
              },
            });
            return {
              ...order,
              loanAccount,
            };
          }),
        );
        return ordersWithLoanAccount;
      });
  }

  /**
   * 处理手动订单
   */
  async processManualOrder(
    adminId: number,
    orderId: string,
    data: {
      periodCount: number;
      totalCapital: number;
      totalInterest: number;
      fines: number;
    },
  ) {
    const role = await this.getAdminRole(adminId);
    if (role !== 'COLLECTOR' && role !== 'ADMIN') {
      throw new ForbiddenException('无权限处理');
    }

    // 获取管理员信息
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { username: true },
    });

    if (!admin) {
      throw new ForbiddenException('管理员不存在');
    }

    return await this.prisma.$transaction(async (tx) => {
      // 1. 验证订单状态
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          loan_id: true,
          payee_id: true,
          payee: {
            select: {
              id: true,
              username: true,
              admin_id: true,
            },
          },
          payment_method: true,
          actual_paid_amount: true,
          needs_manual_processing: true,
          manual_processing_status: true,
        },
      });

      if (!order) {
        throw new NotFoundException('订单不存在');
      }

      if (order.needs_manual_processing !== true) {
        throw new BadRequestException('订单不需要手动处理');
      }

      if (order.manual_processing_status !== 'unprocessed') {
        throw new BadRequestException('订单已处理');
      }

      if (!order.payee) {
        throw new BadRequestException('订单未关联收款人');
      }

      // 获取实际收款人的admin_id（收款人接单并通过审核后）
      const actualCollectorIdForManual = order.payee.admin_id;

      // 2. 获取订单对应的 loanAccount 和 repaymentSchedules
      const loanAccount = await tx.loanAccount.findUnique({
        where: { id: order.loan_id },
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      if (!loanAccount) {
        throw new NotFoundException('贷款账户不存在');
      }

      // 获取 pending 状态的还款计划，按 due_start_date 排序
      const schedules = await tx.repaymentSchedule.findMany({
        where: {
          loan_id: order.loan_id,
          status: 'pending',
        },
        orderBy: {
          due_start_date: 'asc',
        },
      });

      if (schedules.length < data.periodCount) {
        throw new BadRequestException('还款计划数量不足');
      }

      // 验证所有期数的capital是否相等（除了最后一条）
      const expectedCapital = Math.floor(data.totalCapital / data.periodCount);
      for (let i = 0; i < data.periodCount - 1; i++) {
        const scheduleCapital = Number(schedules[i].capital || 0);
        if (scheduleCapital !== expectedCapital) {
          throw new BadRequestException(
            `第 ${i + 1} 期还款计划的本金应为 ${expectedCapital}，实际为 ${scheduleCapital}`,
          );
        }
      }

      // 计算每期的本金和利息
      // 前 n-1 条：capital = totalCapital / periodCount 向下取整
      // 最后一条：capital = totalCapital - 前 n-1 条的和
      const baseCapital = Math.floor(data.totalCapital / data.periodCount);
      const baseInterest = Math.floor(data.totalInterest / data.periodCount);
      const lastCapital =
        data.totalCapital - baseCapital * (data.periodCount - 1);
      const lastInterest =
        data.totalInterest - baseInterest * (data.periodCount - 1);

      // 3. 处理每一期
      let totalPaidAmount = 0;
      let totalPaidCapital = 0;
      let totalPaidInterest = 0;
      const lastPeriodIndex = data.periodCount - 1;

      for (let i = 0; i < data.periodCount; i++) {
        const schedule = schedules[i];
        const isLast = i === lastPeriodIndex;
        const paidCapital = isLast ? lastCapital : baseCapital;
        const paidInterest = isLast ? lastInterest : baseInterest;
        const paidFines = isLast ? data.fines : 0;

        // 计算本期的总还款金额
        const periodPaidAmount = paidCapital + paidInterest + paidFines;
        totalPaidAmount += periodPaidAmount;
        totalPaidCapital += paidCapital;
        totalPaidInterest += paidInterest;
        let status: RepaymentScheduleStatus = 'pending';
        if (paidCapital + paidInterest + paidFines >= 1) {
          status = 'active';
        }
        if (
          Number(schedule.capital) === paidCapital &&
          Number(schedule.interest) === paidInterest
        ) {
          status = 'paid';
        }
        // 4. 更新 repaymentSchedule
        await tx.repaymentSchedule.update({
          where: { id: schedule.id },
          data: {
            status: status,
            paid_capital: paidCapital,
            paid_interest: paidInterest,
            fines: paidFines > 0 ? paidFines : 0,
            paid_amount: periodPaidAmount,
            paid_at: new Date(),
            operator_admin_id: adminId,
            operator_admin_name: order.payee.username,
            collected_by_type: 'manual',
          },
        });
      }
      // 5. 创建还款记录
      if (!order.payee_id) {
        throw new BadRequestException('订单未关联收款人');
      }
      await tx.repaymentRecord.create({
        data: {
          loan_id: order.loan_id,
          user_id: loanAccount.user_id,
          paid_amount: Math.floor(totalPaidAmount),
          paid_amount_decimal: Number(order.actual_paid_amount),
          paid_at: new Date(),
          payment_method: order.payment_method,
          actual_collector_id: actualCollectorIdForManual,
          remark: '客户还款',
          order_id: orderId,
          collected_by_type: 'manual',
          paid_capital: totalPaidCapital,
          paid_interest: totalPaidInterest,
          paid_fines: data.fines > 0 ? data.fines : null,
          repayment_schedule_id: schedules[data.periodCount - 1].id,
        },
      });
      // 更新每日收款统计
      if (order.payee_id) {
        await this.payeeDailyStatisticsService.updateDailyStatistics(
          order.payee_id,
          totalPaidAmount,
        );
      }
      // 6. 更新 LoanAccount
      const currentRepaidPeriods = await tx.repaymentSchedule.count({
        where: {
          loan_id: order.loan_id,
          status: 'paid',
        },
      });

      await tx.loanAccount.update({
        where: { id: order.loan_id },
        data: {
          receiving_amount: {
            increment: totalPaidAmount,
          },
          paid_capital: {
            increment: totalPaidCapital,
          },
          paid_interest: {
            increment: totalPaidInterest,
          },
          total_fines: {
            increment: data.fines,
          },
          repaid_periods: currentRepaidPeriods,
        },
      });

      // 7. 更新订单状态
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          manual_processing_status: 'processed',
          updated_at: new Date(),
        } as any,
      });

      return updatedOrder;
    });
  }

  /**
   * 删除订单
   */
  async deleteOrder(adminId: number, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        payee_id: true,
        amount: true,
        status: true,
      },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    const role = await this.getAdminRole(adminId);
    // 收款人只能删除自己的订单
    if (role === 'PAYEE') {
      const payeeId = await this.getPayeeIdByAdmin(adminId);
      if (!payeeId || order.payee_id !== payeeId) {
        throw new ForbiddenException('无权限删除此订单');
      }
    }

    // 使用事务确保删除订单和恢复额度的原子性
    await this.prisma.$transaction(async (tx) => {
      // 删除订单
      await tx.order.delete({
        where: { id: orderId },
      });

      // 如果订单已被抢单（状态为 grabbed），恢复收款人的剩余额度
      if (order.status === 'grabbed' && order.payee_id) {
        const orderAmount = Number(order.amount);
        await tx.payee.update({
          where: { id: order.payee_id },
          data: {
            remaining_limit: {
              increment: orderAmount,
            },
          },
        });
      }
    });

    return { success: true };
  }
}
