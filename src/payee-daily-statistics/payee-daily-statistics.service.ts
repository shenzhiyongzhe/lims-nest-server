import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PayeeDailyStatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 将Prisma Decimal类型转换为number
   */
  private toNumber(value: any): number {
    if (value === null || value === undefined) {
      return 0;
    }
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const n = parseFloat(value);
      return Number.isNaN(n) ? 0 : n;
    }
    if (typeof value === 'object' && 'toNumber' in value) {
      try {
        return (value as any).toNumber();
      } catch {
        return parseFloat(String(value)) || 0;
      }
    }
    return parseFloat(String(value)) || 0;
  }

  /**
   * 更新payee的每日收款统计（在订单审核完成时调用）
   * @param payeeId 收款人ID
   * @param amount 收款金额（actual_paid_amount）
   * @param date 日期，默认为今天
   */
  async updateDailyStatistics(payeeId: number, amount: number, date?: Date) {
    // 确保amount是number类型
    const amountValue =
      typeof amount === 'number' ? amount : parseFloat(String(amount));
    if (Number.isNaN(amountValue)) {
      throw new Error(`Invalid amount: ${amount}`);
    }

    const targetDate = date || new Date();
    // 设置为当天的0点，使用UTC时间避免时区问题
    const dateOnly = new Date(
      Date.UTC(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        targetDate.getDate(),
      ),
    );

    // 查找或创建当天的统计记录
    const existing = await this.prisma.payeeDailyStatistics.findUnique({
      where: {
        payee_id_date: {
          payee_id: payeeId,
          date: dateOnly,
        },
      },
    });

    if (existing) {
      // 更新现有记录
      const existingDailyTotal = this.toNumber(existing.daily_total);
      const existingTotalAmount = this.toNumber(existing.total_amount);

      const newDailyTotal = existingDailyTotal + amountValue;
      const newTotalAmount = existingTotalAmount + amountValue;

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
            lt: dateOnly,
          },
        },
        _sum: {
          daily_total: true,
        },
      });

      const previousTotalAmount = this.toNumber(previousTotal._sum.daily_total);
      const newTotalAmount = previousTotalAmount + amountValue;

      return await this.prisma.payeeDailyStatistics.create({
        data: {
          payee_id: payeeId,
          date: dateOnly,
          daily_total: amountValue,
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
    // 使用UTC时间避免时区问题
    const dateOnly = new Date(
      Date.UTC(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        targetDate.getDate(),
      ),
    );

    const statistics = await this.prisma.payeeDailyStatistics.findUnique({
      where: {
        payee_id_date: {
          payee_id: payeeId,
          date: dateOnly,
        },
      },
    });

    if (!statistics) {
      return {
        payee_id: payeeId,
        date: dateOnly,
        daily_total: 0,
        total_amount: 0,
      };
    }

    return {
      payee_id: statistics.payee_id,
      date: statistics.date,
      daily_total: this.toNumber(statistics.daily_total),
      total_amount: this.toNumber(statistics.total_amount),
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
