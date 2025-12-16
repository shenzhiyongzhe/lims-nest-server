import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleStatusService } from './schedule-status.service';
import { OverdueService } from './overdue.service';
import { StatisticsCronService } from './statistics.service';
import { PayeeLimitService } from './payee-limit.service';
import { StatisticsModule } from '../statistics/statistics.module';
import { CronController } from './cron.controller';

@Module({
  imports: [PrismaModule, StatisticsModule],
  providers: [
    ScheduleStatusService,
    OverdueService,
    StatisticsCronService,
    PayeeLimitService,
  ],
  controllers: [CronController],
})
export class CronJobsModule {}
