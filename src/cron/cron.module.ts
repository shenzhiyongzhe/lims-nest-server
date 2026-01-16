import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleStatusService } from './schedule-status.service';
import { OverdueService } from './overdue.service';
import { StatisticsCronService } from './statistics.service';
import { StatisticsModule } from '../statistics/statistics.module';
import { CronController } from './cron.controller';
import { EmailResetService } from './email-reset.service';
import { EmailConfigModule } from '../email-config/email-config.module';

@Module({
  imports: [PrismaModule, StatisticsModule, EmailConfigModule],
  providers: [
    ScheduleStatusService,
    OverdueService,
    StatisticsCronService,
    EmailResetService,
  ],
  controllers: [CronController],
})
export class CronJobsModule {}
