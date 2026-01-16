import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmailConfigService } from '../email-config/email-config.service';

@Injectable()
export class EmailResetService {
  private readonly logger = new Logger(EmailResetService.name);

  constructor(private readonly emailConfigService: EmailConfigService) {}

  // 每天凌晨0点重置每日发送计数
  @Cron('0 0 * * *') // 每天00:00执行
  async resetDailyCounts() {
    this.logger.log('🕕 开始执行每日邮箱发送计数重置任务');

    try {
      await this.emailConfigService.resetDailyCounts();
      this.logger.log('✅ 成功重置所有邮箱配置的每日发送计数');
    } catch (error) {
      this.logger.error('❌ 重置每日发送计数失败:', error);
    }
  }
}
