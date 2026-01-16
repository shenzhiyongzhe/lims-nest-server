import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailConfig } from '@prisma/client';
import { CreateEmailConfigDto } from './dto/create-email-config.dto';
import { UpdateEmailConfigDto } from './dto/update-email-config.dto';

@Injectable()
export class EmailConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<EmailConfig[]> {
    return this.prisma.emailConfig.findMany({
      orderBy: { created_at: 'desc' },
    });
  }

  async findById(id: number): Promise<EmailConfig | null> {
    return this.prisma.emailConfig.findUnique({
      where: { id },
      include: {
        emailLogs: {
          take: 10,
          orderBy: { sent_at: 'desc' },
        },
      },
    });
  }

  async findActiveConfigs(): Promise<EmailConfig[]> {
    return this.prisma.emailConfig.findMany({
      where: { is_enabled: true },
      orderBy: { daily_sent_count: 'asc' },
    });
  }

  async create(data: CreateEmailConfigDto): Promise<EmailConfig> {
    return this.prisma.emailConfig.create({
      data: {
        ...data,
        is_enabled: data.is_enabled ?? true,
      },
    });
  }

  async update(
    id: number,
    data: UpdateEmailConfigDto,
  ): Promise<EmailConfig> {
    const config = await this.prisma.emailConfig.findUnique({
      where: { id },
    });

    if (!config) {
      throw new NotFoundException('邮箱配置不存在');
    }

    return this.prisma.emailConfig.update({
      where: { id },
      data,
    });
  }

  async delete(id: number): Promise<EmailConfig> {
    const config = await this.prisma.emailConfig.findUnique({
      where: { id },
    });

    if (!config) {
      throw new NotFoundException('邮箱配置不存在');
    }

    return this.prisma.emailConfig.delete({
      where: { id },
    });
  }

  async toggleEnabled(id: number): Promise<EmailConfig> {
    const config = await this.prisma.emailConfig.findUnique({
      where: { id },
    });

    if (!config) {
      throw new NotFoundException('邮箱配置不存在');
    }

    return this.prisma.emailConfig.update({
      where: { id },
      data: {
        is_enabled: !config.is_enabled,
      },
    });
  }

  async incrementSentCount(id: number): Promise<void> {
    await this.prisma.emailConfig.update({
      where: { id },
      data: {
        daily_sent_count: { increment: 1 },
        total_sent_count: { increment: 1 },
      },
    });
  }

  async resetDailyCounts(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await this.prisma.emailConfig.updateMany({
      data: {
        daily_sent_count: 0,
        last_reset_date: today,
      },
    });
  }

  async getStatistics(id?: number) {
    if (id) {
      const config = await this.prisma.emailConfig.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              emailLogs: true,
            },
          },
        },
      });

      if (!config) {
        throw new NotFoundException('邮箱配置不存在');
      }

      const successCount = await this.prisma.emailLog.count({
        where: {
          email_config_id: id,
          status: 'success',
        },
      });

      const failedCount = await this.prisma.emailLog.count({
        where: {
          email_config_id: id,
          status: 'failed',
        },
      });

      const totalCount = config._count.emailLogs;
      const successRate =
        totalCount > 0 ? (successCount / totalCount) * 100 : 0;

      return {
        ...config,
        statistics: {
          total_sent: totalCount,
          success_count: successCount,
          failed_count: failedCount,
          success_rate: successRate.toFixed(2),
          daily_sent: config.daily_sent_count,
          total_sent_count: config.total_sent_count,
        },
      };
    } else {
      const configs = await this.prisma.emailConfig.findMany({
        include: {
          _count: {
            select: {
              emailLogs: true,
            },
          },
        },
      });

      const statistics = await Promise.all(
        configs.map(async (config) => {
          const successCount = await this.prisma.emailLog.count({
            where: {
              email_config_id: config.id,
              status: 'success',
            },
          });

          const failedCount = await this.prisma.emailLog.count({
            where: {
              email_config_id: config.id,
              status: 'failed',
            },
          });

          const totalCount = config._count.emailLogs;
          const successRate =
            totalCount > 0 ? (successCount / totalCount) * 100 : 0;

          return {
            id: config.id,
            name: config.name,
            total_sent: totalCount,
            success_count: successCount,
            failed_count: failedCount,
            success_rate: successRate.toFixed(2),
            daily_sent: config.daily_sent_count,
            total_sent_count: config.total_sent_count,
            is_enabled: config.is_enabled,
          };
        }),
      );

      const totalSent = statistics.reduce(
        (sum, stat) => sum + stat.total_sent,
        0,
      );
      const totalSuccess = statistics.reduce(
        (sum, stat) => sum + stat.success_count,
        0,
      );
      const totalDailySent = statistics.reduce(
        (sum, stat) => sum + stat.daily_sent,
        0,
      );
      const overallSuccessRate =
        totalSent > 0 ? (totalSuccess / totalSent) * 100 : 0;

      return {
        configs: statistics,
        overall: {
          total_sent: totalSent,
          success_count: totalSuccess,
          failed_count: totalSent - totalSuccess,
          success_rate: overallSuccessRate.toFixed(2),
          daily_sent: totalDailySent,
        },
      };
    }
  }
}
