import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PayeeRankingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取所有收款人的排行榜（按尾数总和从高到低排序）
   */
  async getRankings() {
    const rankings = await this.prisma.payeeRanking.findMany({
      include: {
        payee: {
          include: {
            admin: {
              select: {
                username: true,
              },
            },
          },
        },
      },
      orderBy: {
        decimal_sum: 'desc',
      },
    });

    return rankings.map((ranking) => ({
      payee_id: ranking.payee_id,
      payee_name: ranking.payee.username,
      decimal_sum: Number(ranking.decimal_sum),
      updated_at: ranking.updated_at,
    }));
  }

  /**
   * 更新收款人的尾数总和
   * @param payeeId 收款人ID
   * @param decimalAmount 要累加的尾数（小数部分）
   */
  async updateDecimalSum(payeeId: number, decimalAmount: number) {
    // 确保 payeeRanking 记录存在
    const existing = await this.prisma.payeeRanking.findUnique({
      where: { payee_id: payeeId },
    });

    if (existing) {
      // 更新现有记录
      const newSum = Number(existing.decimal_sum) + decimalAmount;
      return await this.prisma.payeeRanking.update({
        where: { payee_id: payeeId },
        data: {
          decimal_sum: newSum,
        },
      });
    } else {
      // 创建新记录
      return await this.prisma.payeeRanking.create({
        data: {
          payee_id: payeeId,
          decimal_sum: decimalAmount,
        },
      });
    }
  }

  /**
   * 获取指定收款人的尾数总和
   */
  async getPayeeRanking(payeeId: number) {
    const ranking = await this.prisma.payeeRanking.findUnique({
      where: { payee_id: payeeId },
      include: {
        payee: true,
      },
    });

    if (!ranking) {
      return {
        payee_id: payeeId,
        decimal_sum: 0,
      };
    }

    return {
      payee_id: ranking.payee_id,
      decimal_sum: Number(ranking.decimal_sum),
      updated_at: ranking.updated_at,
    };
  }
}
