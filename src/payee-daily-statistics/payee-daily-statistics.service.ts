import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PayeeDailyStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 更新payee的每日收款统计（在订单审核完成时调用）
   * @param payeeId 收款人ID
   * @param amount 收款金额（actual_paid_amount）
   * @param date 日期，默认为今天
   */
  async updateDailyStatistics(payeeId: number, amount: number, date?: Date) {
    const targetDate = date || new Date();
    // 设置为当天的0点
    targetDate.setHours(0, 0, 0, 0);

    // 查找或创建当天的统计记录
    const existing = await this.prisma.payeeDailyStatistics.findUnique({
      where: {
        payee_id_date: {
          payee_id: payeeId,
          date: targetDate,
        },
      },
    });

    if (existing) {
      // 更新现有记录
      const newDailyTotal = Number(existing.daily_total) + amount;
      const newTotalAmount = Number(existing.total_amount) + amount;

      return await this.prisma.payeeDailyStatistics.update({
        where: {
          id: existing.id,
        },
        data: {
          daily_total: newDailyTotal,
          total_amount: newTotalAmount,
        },
      });
    } else {
      // 创建新记录
      // 先计算累计总金额（所有历史记录的总和）
      const previousTotal = await this.prisma.payeeDailyStatistics.aggregate({
        where: {
          payee_id: payeeId,
          date: {
            lt: targetDate,
          },
        },
        _sum: {
          daily_total: true,
        },
      });

      const previousTotalAmount = Number(previousTotal._sum.daily_total || 0);
      const newTotalAmount = previousTotalAmount + amount;

      return await this.prisma.payeeDailyStatistics.create({
        data: {
          payee_id: payeeId,
          date: targetDate,
          daily_total: amount,
          total_amount: newTotalAmount,
        },
      });
    }
  }

  /**
   * 获取payee的每日统计信息
   * @param payeeId 收款人ID
   * @param date 日期，默认为今天
   */
  async getDailyStatistics(payeeId: number, date?: Date) {
    const targetDate = date || new Date();
    targetDate.setHours(0, 0, 0, 0);

    const statistics = await this.prisma.payeeDailyStatistics.findUnique({
      where: {
        payee_id_date: {
          payee_id: payeeId,
          date: targetDate,
        },
      },
    });

    if (!statistics) {
      return {
        payee_id: payeeId,
        date: targetDate,
        daily_total: 0,
        total_amount: 0,
      };
    }

    return {
      payee_id: statistics.payee_id,
      date: statistics.date,
      daily_total: Number(statistics.daily_total),
      total_amount: Number(statistics.total_amount),
    };
  }

  /**
   * 获取payee的今日和昨日统计信息
   * @param payeeId 收款人ID
   */
  async getTodayAndYesterdayStatistics(payeeId: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const [todayStats, yesterdayStats] = await Promise.all([
      this.getDailyStatistics(payeeId, today),
      this.getDailyStatistics(payeeId, yesterday),
    ]);

    return {
      today: todayStats,
      yesterday: yesterdayStats,
    };
  }
}
