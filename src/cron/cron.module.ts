import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScheduleStatusService } from './schedule-status.service';
import { OverdueService } from './overdue.service';

@Module({
  imports: [PrismaModule],
  providers: [ScheduleStatusService, OverdueService],
})
export class CronJobsModule {}
