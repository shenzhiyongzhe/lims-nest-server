import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { PayeeRankingModule } from '../payee-ranking/payee-ranking.module';
import { PayeeDailyStatisticsModule } from '../payee-daily-statistics/payee-daily-statistics.module';

@Module({
  imports: [PrismaModule, PayeeRankingModule, PayeeDailyStatisticsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
