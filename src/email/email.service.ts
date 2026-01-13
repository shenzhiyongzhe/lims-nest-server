import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    // 从环境变量读取SMTP配置
    const smtpConfig = {
      host: process.env.SMTP_HOST || 'smtp.qq.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: false, // QQ邮箱使用587端口，需要secure: false
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS, // QQ邮箱授权码
      },
    };

    // 创建邮件传输器
    this.transporter = nodemailer.createTransport(smtpConfig);
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

    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: toEmail,
        subject,
        html,
      });
      this.logger.log(`支付成功邮件已发送至: ${toEmail}`);
    } catch (error) {
      this.logger.error(`发送支付成功邮件失败: ${error.message}`, error.stack);
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

    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: toEmail,
        subject,
        html,
      });
      this.logger.log(`手动处理通知邮件已发送至: ${toEmail}`);
    } catch (error) {
      this.logger.error(
        `发送手动处理通知邮件失败: ${error.message}`,
        error.stack,
      );
      // 不抛出异常，避免影响主流程
    }
  }
}
