import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailConfigService } from '../email-config/email-config.service';
import { EmailConfig } from '@prisma/client';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailConfigService: EmailConfigService,
  ) {}

  /**
   * 获取所有启用的邮箱配置
   */
  private async getActiveEmailConfigs(): Promise<EmailConfig[]> {
    return this.emailConfigService.findActiveConfigs();
  }

  /**
   * 选择用于发送的邮箱（轮询算法）
   */
  private async selectEmailForSending(): Promise<EmailConfig | null> {
    const configs = await this.getActiveEmailConfigs();

    // 过滤掉今日已发送500封的邮箱
    const availableConfigs = configs.filter((c) => c.daily_sent_count < 500);

    if (availableConfigs.length === 0) {
      this.logger.error('所有邮箱今日发送量已达上限（500封）');
      return null;
    }

    // 按发送量升序排序，选择发送量最少的
    return availableConfigs.sort(
      (a, b) => a.daily_sent_count - b.daily_sent_count,
    )[0];
  }

  /**
   * 创建邮件传输器
   */
  private createTransporter(config: EmailConfig): nodemailer.Transporter {
    const smtpConfig = {
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    };

    return nodemailer.createTransport(smtpConfig);
  }

  /**
   * 记录邮件发送日志
   */
  private async logEmail(
    configId: number,
    toEmail: string,
    subject: string,
    status: 'success' | 'failed',
    errorMessage?: string,
  ): Promise<void> {
    try {
      await this.prisma.emailLog.create({
        data: {
          email_config_id: configId,
          to_email: toEmail,
          subject,
          status,
          error_message: errorMessage,
        },
      });
    } catch (error) {
      this.logger.error(`记录邮件日志失败: ${error.message}`, error.stack);
    }
  }

  /**
   * 发送支付成功邮件给收款人
   */
  async sendPaymentSuccessEmail(
    toEmail: string,
    customerName: string,
    paymentAmount: number,
    orderId: string,
  ): Promise<void> {
    if (!toEmail) {
      this.logger.warn('收款人邮箱为空，跳过发送邮件');
      return;
    }

    // 选择邮箱配置
    const config = await this.selectEmailForSending();
    if (!config) {
      this.logger.error('没有可用的邮箱配置，无法发送邮件');
      return;
    }

    const subject = '支付成功通知';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            border: 1px solid #ddd;
            border-radius: 5px;
          }
          .header {
            background-color: #4CAF50;
            color: white;
            padding: 20px;
            text-align: center;
            border-radius: 5px 5px 0 0;
          }
          .content {
            padding: 20px;
          }
          .info-row {
            margin: 15px 0;
            padding: 10px;
            background-color: #f9f9f9;
            border-left: 4px solid #4CAF50;
          }
          .amount {
            font-size: 24px;
            font-weight: bold;
            color: #4CAF50;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>支付成功通知</h1>
          </div>
          <div class="content">
            <p>尊敬的收款人，您好！</p>
            <p>您收到了一笔新的支付，详情如下：</p>
            
            <div class="info-row">
              <strong>客户姓名：</strong> ${customerName}
            </div>
            
            <div class="info-row">
              <strong>支付金额：</strong> <span class="amount">¥${paymentAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            
            <div class="info-row">
              <strong>订单ID：</strong> ${orderId}
            </div>
            
            <div class="info-row">
              <strong>支付时间：</strong> ${new Date().toLocaleString('zh-CN')}
            </div>
            
            <p style="margin-top: 20px;">感谢您的使用！</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const transporter = this.createTransporter(config);
    const fromEmail = config.from || config.user;

    try {
      await transporter.sendMail({
        from: fromEmail,
        to: toEmail,
        subject,
        html,
      });

      // 更新发送计数
      await this.emailConfigService.incrementSentCount(config.id);

      // 记录成功日志
      await this.logEmail(config.id, toEmail, subject, 'success');

      this.logger.log(
        `支付成功邮件已发送至: ${toEmail} (使用邮箱: ${config.name})`,
      );
    } catch (error) {
      // 记录失败日志
      await this.logEmail(config.id, toEmail, subject, 'failed', error.message);

      this.logger.error(
        `发送支付成功邮件失败: ${error.message} (使用邮箱: ${config.name})`,
        error.stack,
      );
      // 不抛出异常，避免影响主流程
    }
  }

  /**
   * 发送手动处理通知邮件给负责人
   */
  async sendManualProcessingEmail(
    toEmail: string,
    orderId: string,
    customerName: string,
    loanId: string,
    actualPaidAmount: number,
  ): Promise<void> {
    if (!toEmail) {
      this.logger.warn('负责人邮箱为空，跳过发送邮件');
      return;
    }

    // 选择邮箱配置
    const config = await this.selectEmailForSending();
    if (!config) {
      this.logger.error('没有可用的邮箱配置，无法发送邮件');
      return;
    }

    const subject = '订单需要手动处理';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            border: 1px solid #ddd;
            border-radius: 5px;
          }
          .header {
            background-color: #FF9800;
            color: white;
            padding: 20px;
            text-align: center;
            border-radius: 5px 5px 0 0;
          }
          .content {
            padding: 20px;
          }
          .info-row {
            margin: 15px 0;
            padding: 10px;
            background-color: #f9f9f9;
            border-left: 4px solid #FF9800;
          }
          .warning {
            background-color: #fff3cd;
            border-left-color: #ffc107;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
          }
          .amount {
            font-size: 24px;
            font-weight: bold;
            color: #FF9800;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>订单需要手动处理</h1>
          </div>
          <div class="content">
            <p>尊敬的负责人，您好！</p>
            <p>有一个订单需要您手动处理，详情如下：</p>
            
            <div class="info-row">
              <strong>订单ID：</strong> ${orderId}
            </div>
            
            <div class="info-row">
              <strong>客户姓名：</strong> ${customerName}
            </div>
            
            <div class="info-row">
              <strong>贷款ID：</strong> ${loanId}
            </div>
            
            <div class="info-row">
              <strong>实付金额：</strong> <span class="amount">¥${actualPaidAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            
            <div class="warning">
              <strong>⚠️ 处理说明：</strong><br>
              该订单的实付金额与预期金额不匹配，需要您手动处理还款计划的分配。请登录系统查看订单详情并进行处理。
            </div>
            
            <div class="info-row">
              <strong>创建时间：</strong> ${new Date().toLocaleString('zh-CN')}
            </div>
            
            <p style="margin-top: 20px;">请及时处理该订单，感谢您的配合！</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const transporter = this.createTransporter(config);
    const fromEmail = config.from || config.user;

    try {
      await transporter.sendMail({
        from: fromEmail,
        to: toEmail,
        subject,
        html,
      });

      // 更新发送计数
      await this.emailConfigService.incrementSentCount(config.id);

      // 记录成功日志
      await this.logEmail(config.id, toEmail, subject, 'success');

      this.logger.log(
        `手动处理通知邮件已发送至: ${toEmail} (使用邮箱: ${config.name})`,
      );
    } catch (error) {
      // 记录失败日志
      await this.logEmail(config.id, toEmail, subject, 'failed', error.message);

      this.logger.error(
        `发送手动处理通知邮件失败: ${error.message} (使用邮箱: ${config.name})`,
        error.stack,
      );
      // 不抛出异常，避免影响主流程
    }
  }
}
