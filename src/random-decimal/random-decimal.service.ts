import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RandomDecimalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取或生成当天的随机小数（1-99）
   * @param loanId 贷款账户ID
   * @param period 期数
   * @returns 随机小数（1-99）
   */
  async getDailyRandomDecimal(loanId: string, period: number): Promise<number> {
    // 获取当天的日期（使用UTC，避免时区问题）
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    // 先尝试查询是否已存在
    const existing = await this.prisma.dailyRandomDecimal.findFirst({
      where: {
        loan_id: loanId,
        period: period,
        date: today,
      },
    });

    if (existing) {
      // 如果已存在，直接返回
      return existing.decimal;
    }

    // 如果不存在，生成新的随机数并创建
    // 使用事务和 try-catch 处理并发情况
    try {
      const randomDecimal = Math.floor(Math.random() * 99) + 1;
      const created = await this.prisma.dailyRandomDecimal.create({
        data: {
          loan_id: loanId,
          period: period,
          date: today,
          decimal: randomDecimal,
        },
      });
      return created.decimal;
    } catch (error: any) {
      // 如果因为唯一约束冲突失败（并发情况），再次查询
      if (error.code === 'P2002') {
        const existingAfterConflict =
          await this.prisma.dailyRandomDecimal.findFirst({
            where: {
              loan_id: loanId,
              period: period,
              date: today,
            },
          });
        if (existingAfterConflict) {
          return existingAfterConflict.decimal;
        }
      }
      throw error;
    }
  }
}
