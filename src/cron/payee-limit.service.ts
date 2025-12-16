import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PayeeLimitService {
  private readonly logger = new Logger(PayeeLimitService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 每天早上6点重置所有收款人的剩余额度为总额度
   * Cron 表达式：'0 6 * * *' 表示每天6:00执行
   */
  @Cron('0 6 * * *')
  async resetRemainingLimits() {
    this.logger.log('🔄 开始重置收款人剩余额度...');

    try {
      // 获取收款人数量用于日志
      const payeeCount = await this.prisma.payee.count();
      this.logger.log(`📋 找到 ${payeeCount} 个收款人`);

      // 使用原始 SQL 来直接设置 remaining_limit = payment_limit
      // 因为 Prisma 的 updateMany 不支持引用同一行的其他字段
      const updateResult = await this.prisma.$executeRaw`
        UPDATE payees 
        SET remaining_limit = payment_limit
      `;

      this.logger.log(`✅ 成功重置 ${updateResult} 个收款人的剩余额度为总额度`);
    } catch (error) {
      this.logger.error('❌ 重置收款人剩余额度失败:', error);
      throw error;
    }
  }
}
