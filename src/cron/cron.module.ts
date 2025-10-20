import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleStatusService } from './schedule-status.service';
import { OverdueService } from './overdue.service';
import { StatisticsCronService } from './statistics.service';
import { StatisticsModule } from '../statistics/statistics.module';
import { VisitorsCronService } from './visitors.service';
import { VisitorsModule } from '../visitors/visitors.module';

@Module({
  imports: [PrismaModule, StatisticsModule, VisitorsModule],
  providers: [
    ScheduleStatusService,
    OverdueService,
    StatisticsCronService,
    VisitorsCronService,
  ],
})
export class CronJobsModule {}
