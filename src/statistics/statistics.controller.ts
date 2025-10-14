import { Controller, Get, UseGuards } from '@nestjs/common';
import { StatisticsService } from './statistics.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('statistics')
@UseGuards(AuthGuard, RolesGuard)
export class StatisticsController {
  constructor(
    private readonly statisticsService: StatisticsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async getStatistics(
    @CurrentUser() user: { id: number },
  ): Promise<ApiResponseDto> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: user.id },
      select: { role: true },
    });

    if (!admin) {
      return ResponseHelper.error('用户不存在', 404);
    }

    const stats = await this.statisticsService.getStatistics(
      user.id,
      admin.role as string,
    );

    return ResponseHelper.success(stats, '获取统计数据成功');
  }
}
