import {
  Controller,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ManagementRoles } from '@prisma/client';
import { OverdueService } from './overdue.service';
import { ScheduleStatusService } from './schedule-status.service';
import { StatisticsCronService } from './statistics.service';
import { PayeeLimitService } from './payee-limit.service';
import { ResponseHelper } from '../common/response-helper';
import { ApiResponseDto } from '../common/dto/api-response.dto';

@Controller('cron')
@UseGuards(AuthGuard, RolesGuard)
@Roles(ManagementRoles.管理员, ManagementRoles.负责人) // 只有管理员可以手动触发定时任务
export class CronController {
  constructor(
    private readonly overdueService: OverdueService,
    private readonly scheduleStatusService: ScheduleStatusService,
    private readonly statisticsCronService: StatisticsCronService,
    private readonly payeeLimitService: PayeeLimitService,
  ) {}

  /**
   * 手动触发逾期记录生成任务
   * POST /cron/trigger/overdue-records
   */
  @Post('trigger/overdue-records')
  @HttpCode(HttpStatus.OK)
  async triggerOverdueRecords(): Promise<ApiResponseDto> {
    try {
      await this.overdueService.generateDailyOverdueRecords();
      return ResponseHelper.success(null, '逾期记录生成任务执行成功');
    } catch (error: any) {
      return ResponseHelper.error(
        `逾期记录生成任务执行失败: ${error.message}`,
        500,
      );
    }
  }

  /**
   * 手动触发还款计划状态更新任务
   * POST /cron/trigger/schedule-status
   */
  @Post('trigger/schedule-status')
  @HttpCode(HttpStatus.OK)
  async triggerScheduleStatus(): Promise<ApiResponseDto> {
    try {
      await this.scheduleStatusService.updateRepaymentScheduleStatuses();
      return ResponseHelper.success(null, '还款计划状态更新任务执行成功');
    } catch (error: any) {
      return ResponseHelper.error(
        `还款计划状态更新任务执行失败: ${error.message}`,
        500,
      );
    }
  }

  /**
   * 手动触发每日统计计算任务
   * POST /cron/trigger/statistics
   */
  @Post('trigger/statistics')
  @HttpCode(HttpStatus.OK)
  async triggerStatistics(): Promise<ApiResponseDto> {
    try {
      await this.statisticsCronService.handleDailyStatisticsCalculation();
      return ResponseHelper.success(null, '每日统计计算任务执行成功');
    } catch (error: any) {
      return ResponseHelper.error(
        `每日统计计算任务执行失败: ${error.message}`,
        500,
      );
    }
  }

  /**
   * 手动触发缺失统计数据检查任务
   * POST /cron/trigger/missing-statistics
   */
  @Post('trigger/missing-statistics')
  @HttpCode(HttpStatus.OK)
  async triggerMissingStatistics(): Promise<ApiResponseDto> {
    try {
      await this.statisticsCronService.handleMissingStatisticsCalculation();
      return ResponseHelper.success(null, '缺失统计数据检查任务执行成功');
    } catch (error: any) {
      return ResponseHelper.error(
        `缺失统计数据检查任务执行失败: ${error.message}`,
        500,
      );
    }
  }

  /**
   * 手动触发收款人剩余额度重置任务
   * POST /cron/trigger/reset-payee-limits
   */
  @Post('trigger/reset-payee-limits')
  @HttpCode(HttpStatus.OK)
  async triggerResetPayeeLimits(): Promise<ApiResponseDto> {
    try {
      await this.payeeLimitService.resetRemainingLimits();
      return ResponseHelper.success(null, '收款人剩余额度重置任务执行成功');
    } catch (error: any) {
      return ResponseHelper.error(
        `收款人剩余额度重置任务执行失败: ${error.message}`,
        500,
      );
    }
  }
}
