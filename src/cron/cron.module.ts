import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleStatusService } from './schedule-status.service';
import { OverdueService } from './overdue.service';
import { StatisticsCronService } from './statistics.service';
import { StatisticsModule } from '../statistics/statistics.module';

@Module({
  imports: [PrismaModule, StatisticsModule],
  providers: [ScheduleStatusService, OverdueService, StatisticsCronService],
})
export class CronJobsModule {}
