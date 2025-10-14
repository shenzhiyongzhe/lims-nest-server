import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { ShareLinkResponseDto } from './dto/share-link-response.dto';
import * as crypto from 'crypto';

@Injectable()
export class ShareLinksService {
  constructor(private readonly prisma: PrismaService) {}

  private generateShortId(): string {
    return crypto.randomBytes(4).toString('hex'); // 8位十六进制字符串
  }

  async createShareLink(
    data: CreateShareLinkDto,
    createdBy: number,
    baseUrl: string,
  ): Promise<ShareLinkResponseDto> {
    const { ids } = data;

    if (ids.length === 0) {
      throw new BadRequestException('ids数组不能为空');
    }

    // 查询所有指定的还款计划
    const schedules = await this.prisma.repaymentSchedule.findMany({
      where: {
        id: {
          in: ids,
        },
        status: { in: ['pending', 'active', 'overtime', 'overdue'] },
      },
      orderBy: [{ period: 'asc' }],
      select: {
        id: true,
        loan_id: true,
        period: true,
        due_amount: true,
        capital: true,
        interest: true,
        due_end_date: true,
        status: true,
      },
    });

    if (schedules.length === 0) {
      throw new NotFoundException('未找到指定的还款计划');
    }

    const loan_account = await this.prisma.loanAccount.findUnique({
      where: { id: schedules[0].loan_id },
      include: {
        user: true,
      },
    });

    if (!loan_account) {
      throw new NotFoundException('未找到指定的贷款账户');
    }

    // 计算总计
    const today = new Date();
    today.setHours(6, 0, 0, 0); // 设置为今天的开始时间

    let totalDueAmount = 0;
    let totalCapital = 0;
    let totalInterest = 0;

    schedules.forEach((schedule) => {
      const dueEndDate = new Date(schedule.due_end_date);
      dueEndDate.setHours(6, 0, 0, 0); // 设置为截止日期的开始时间

      // 累加due_amount和capital
      totalDueAmount += parseFloat(schedule.due_amount.toString());
      totalCapital += parseFloat((schedule.capital || 0).toString());

      // 如果截止日期在今天之后，则不计算interest
      if (schedule.due_end_date <= today) {
        totalInterest += parseFloat((schedule.interest || 0).toString());
      }
    });

    const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3小时后过期
    const shareId = this.generateShortId();

    // 准备存储的数据
    const summary = {
      user: loan_account.user,
      loan_id: loan_account.id,
      total_periods: loan_account.total_periods,
      repaid_periods: loan_account.repaid_periods,
      total_due_amount: totalDueAmount.toFixed(2),
      total_capital: totalCapital.toFixed(2),
      total_interest: totalInterest.toFixed(2),
      payable_amount: (totalCapital + totalInterest).toFixed(2),
      count: schedules.length,
      today: today.toISOString().split('T')[0],
      due_end_date: schedules[0].due_end_date,
    };

    // 存储到数据库
    await this.prisma.shareLink.create({
      data: {
        share_id: shareId,
        schedule_ids: JSON.stringify(ids),
        summary: JSON.stringify(summary),
        expires_at: expiresAt,
        created_by: createdBy,
      },
    });

    // 生成分享链接
    const shareUrl = `${baseUrl}/page/share-links?token=${shareId}`;

    return {
      shareUrl,
      expiresAt,
      shareId,
    };
  }

  async getShareLink(shareId: string) {
    const shareLink = await this.prisma.shareLink.findUnique({
      where: { share_id: shareId },
    });

    if (!shareLink) {
      throw new NotFoundException('分享链接不存在');
    }

    if (shareLink.expires_at < new Date()) {
      throw new BadRequestException('分享链接已过期');
    }

    return shareLink;
  }
}
