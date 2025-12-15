import { Module } from '@nestjs/common';
import { PayeeDailyStatisticsService } from './payee-daily-statistics.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PayeeDailyStatisticsService],
  exports: [PayeeDailyStatisticsService],
})
export class PayeeDailyStatisticsModule {}
