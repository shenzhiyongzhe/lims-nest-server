import { Module } from '@nestjs/common';
import { PayeesController } from './payees.controller';
import { PayeesService } from './payees.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { PayeeDailyStatisticsModule } from '../payee-daily-statistics/payee-daily-statistics.module';

@Module({
  imports: [PrismaModule, PayeeDailyStatisticsModule],
  controllers: [PayeesController],
  providers: [PayeesService],
  exports: [PayeesService],
})
export class PayeesModule {}
